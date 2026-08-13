/**
 * useImageAttachments — 图片附件状态管理
 *
 * 对齐 Hermes Desktop use-prompt-actions 图片附件流程：
 * 1. 用户粘贴/拖拽/选择图片 → 读取为 base64
 * 2. 调用 image.attach_bytes WS 命令上传到后端
 * 3. 后端写入 ELEVE_HOME/images/ 并存储到 session.attached_images
 * 4. 前端维护本地预览状态
 * 5. 发送 prompt.submit 时后端自动 drain 消费
 *
 * 架构：纯状态管理层，不涉及 UI 渲染（UI 由 InputArea 负责）
 */

import { useState, useCallback, useRef } from 'react';
import { getWsClient, type ImageAttachResponse } from '@/services/ws-client';
import { readFileAsDataURL, base64FromDataURL, mimeFromExt, arrayBufferToBase64 } from '@/utils/file';
import { isRemoteMode, loadConnection } from '@/lib/connection';

export interface AttachedImage {
  /** 本地唯一 ID（用于 React key + 删除定位） */
  id: string;
  /** 后端返回的文件路径（用于 image.detach） */
  path: string;
  /** 文件名（显示用） */
  name: string;
  /** base64 data URL（用于本地预览，不传给后端） */
  preview: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否已上传到后端 session.attached_images。
   * 无会话时仅本地暂存（false），submit 时由 uploadUnuploaded() 上传（对齐 Hermes 延迟上传语义） */
  uploaded: boolean;
}

/** 客户端预检限制（对齐后端 ws/mod.rs 25MB 限制） */
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
/** 最多同时附加 10 张图片（内存保护） */
const MAX_IMAGES = 10;
/** 支持的图片 MIME 类型 */
const ACCEPTED_MIME_PREFIX = 'image/';

export function useImageAttachments(options?: {
  /** per-agent 场景：返回当前目标 session_id（空则走全局 this.sessionId） */
  getSessionId?: () => string | null | undefined;
}) {
  const getSessionIdRef = useRef(options?.getSessionId);
  getSessionIdRef.current = options?.getSessionId;
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  /** 上传中的图片数量（用于 UI 显示 loading 状态） */
  const [uploading, setUploading] = useState(0);
  /** 最近一次错误信息（用于 UI 显示 toast） */
  const [error, setError] = useState<string | null>(null);
  /** 正在上传的文件名集合（防止重复上传） */
  const uploadingFiles = useRef<Set<string>>(new Set());

  const addImage = useCallback(async (file: File): Promise<AttachedImage | null> => {    // 1. 客户端预检：MIME 类型
    if (!file.type.startsWith(ACCEPTED_MIME_PREFIX)) {
      setError(`不支持的文件类型: ${file.type}（仅支持图片）`);
      return null;
    }

    // 2. 客户端预检：文件大小
    if (file.size > MAX_IMAGE_SIZE) {
      setError(`图片过大: ${(file.size / 1024 / 1024).toFixed(1)}MB（上限 25MB）`);
      return null;
    }

    // 3. 客户端预检：数量限制
    if (attachedImages.length >= MAX_IMAGES) {
      setError(`最多附加 ${MAX_IMAGES} 张图片`);
      return null;
    }

    // 4. 防止重复上传同一文件
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (uploadingFiles.current.has(fileKey)) {
      return null;
    }
    uploadingFiles.current.add(fileKey);

    setUploading((n) => n + 1);
    setError(null);

    try {
      // 5. 读取文件为 base64 data URL（用于本地预览）
      const dataUrl = await readFileAsDataURL(file);

      // 🔴 对齐 Hermes "Images are intentionally NOT eager-uploaded"（submit.ts 注释）：
      // 图片从不 eager 上传——Hermes 理由：previewUrl 二次写入竞争 + 不发送则后端零残留；
      // 全部在 submit 时由 uploadUnuploaded() 统一 image.attach_bytes。
      // Rust 长生命周期：会话是常驻 Actor，禁止为新会话草稿 eager 建会话（会泄漏持久 Actor）。
      const staged: AttachedImage = {
        id: crypto.randomUUID(),
        path: '',
        name: file.name,
        preview: dataUrl,
        size: file.size,
        uploaded: false,
      };
      setAttachedImages((prev) => [...prev, staged]);
      return staged;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`图片读取失败: ${msg}`);
      return null;
    } finally {
      uploadingFiles.current.delete(fileKey);
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [attachedImages.length]);

  /** 从本地路径附加图片（Tauri 原生对话框场景）— 对齐 Hermes attachImagePath：
   * 本地模式 → image.attach 路径引用快路径（后端直接读原文件，零拷贝）；
   * remote 模式 → 读文件字节 attach_bytes 上传（后端读不到客户端路径）。
   */
  const addImageFromPath = useCallback(async (path: string): Promise<AttachedImage | null> => {
    let dataUrl: string
    let fileSize = 0
    // 数量限制（与 addImage 的 MAX_IMAGES 同款内存保护）
    if (attachedImages.length >= MAX_IMAGES) {
      setError(`最多附加 ${MAX_IMAGES} 张图片`);
      return null;
    }
    try {
      // 先 stat 后读：25MB+ 文件不读字节直接拒绝（对齐后端上限；防止大文件先爆内存）
      const { readFile, stat } = await import('@tauri-apps/plugin-fs');
      const info = await stat(path);
      fileSize = Number(info.size ?? 0);
      if (fileSize > MAX_IMAGE_SIZE) {
        setError(`图片过大: ${(fileSize / 1024 / 1024).toFixed(1)}MB（上限 25MB）`);
        return null;
      }
      // 读文件字节 → data URL（预览用；Tauri 环境 plugin-fs，浏览器模式不可达）
      const bytes = await readFile(path);
      const mime = mimeFromExt(path) ?? 'image/png';
      const b64 = arrayBufferToBase64(bytes);
      dataUrl = `data:${mime};base64,${b64}`;
    } catch (err) {
      setError(`读取图片失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    const name = path.split(/[\\/]/).pop() || 'image';
    setUploading((n) => n + 1);
    try {
      const wsClient = getWsClient();
      const sessionId = getSessionIdRef.current?.() ?? undefined;
      let result: ImageAttachResponse;
      if (isRemoteMode(loadConnection())) {
        // remote：后端看不到客户端路径 → 字节上传（Hermes readImageForRemoteAttach 语义）
        result = await wsClient.imageAttachBytes(base64FromDataURL(dataUrl), name, sessionId);
      } else {
        // 本地快路径：路径引用，后端直接读原文件（Hermes image.attach 语义）
        result = await wsClient.imageAttach(path, sessionId);
      }
      if (!result.attached || !result.path) {
        setError((result as unknown as { error?: string }).error || '后端未确认附件');
        return null;
      }
      const newImage: AttachedImage = {
        id: crypto.randomUUID(),
        path: result.path,
        name,
        preview: dataUrl,
        size: result.bytes ?? fileSize,
        uploaded: true,
      };
      setAttachedImages((prev) => [...prev, newImage]);
      return newImage;
    } catch (err) {
      setError(`图片上传失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [attachedImages.length]);

  const removeImage = useCallback(async (id: string): Promise<void> => {
    const image = attachedImages.find((img) => img.id === id);
    if (!image) return;

    // 先从本地状态移除（即时响应）
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));

    // 调用后端 image.detach 移除（仅对已上传到后端的图片；本地暂存的无后端状态，无需 detach）
    if (image.uploaded && image.path) {
      try {
        const wsClient = getWsClient();
        await wsClient.imageDetach(image.path, getSessionIdRef.current?.() ?? undefined);
      } catch (err) {
        // 后端 detach 失败不阻塞 UI，记录错误即可
        console.warn('[useImageAttachments] detach failed:', err);
      }
    }
  }, [attachedImages]);

  /** submit 时上传所有本地暂存（uploaded=false）的图片 — 对齐 Hermes syncAttachmentsForSubmit。
   * 调用方（App.handleSend）须先确保会话存在（无则 session.create 懒创建），再传入 sessionId。
   * @returns { ok: true=全部成功；false=有失败（已 setError，调用方应中止发送）; paths: 本次上传的
   *   后端路径（调用方在"上传期间会话已切换"时用于 detach 清理残留，防旧会话下次 submit 幽灵 drain） }
   */
  const uploadUnuploaded = useCallback(async (sessionId: string): Promise<{ ok: boolean; paths: string[] }> => {
    const pending = attachedImages.filter((img) => !img.uploaded);
    if (pending.length === 0) return { ok: true, paths: [] };

    // 对齐 Hermes uploadState spinner：submit 时统一上传转圈（lazy 语义下 uploading 仅此处活跃）
    setUploading(pending.length);

    const wsClient = getWsClient();
    const updatedPaths = new Map<string, string>();
    let allOk = true;

    for (const img of pending) {
      try {
        const contentBase64 = base64FromDataURL(img.preview);
        const result: ImageAttachResponse = await wsClient.imageAttachBytes(
          contentBase64,
          img.name,
          sessionId,
        );
        if (result.attached && result.path) {
          updatedPaths.set(img.id, result.path);
        } else {
          allOk = false;
          setError(`图片上传失败: ${img.name}（后端未确认附件）`);
        }
      } catch (err) {
        allOk = false;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`图片上传失败: ${msg}`);
      }
    }

    setUploading(0);

    // 标记已上传 + 补后端 path（供后续 detach / busy 排队分离使用）
    if (updatedPaths.size > 0) {
      setAttachedImages((prev) =>
        prev.map((img) =>
          updatedPaths.has(img.id)
            ? { ...img, uploaded: true, path: updatedPaths.get(img.id)! }
            : img,
        ),
      );
    }

    return { ok: allOk, paths: [...updatedPaths.values()] };
  }, [attachedImages]);

  const clearImages = useCallback(() => {
    // 不逐个调 detach —— 发送 prompt.submit 后后端会自动 drain 清空
    setAttachedImages([]);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    attachedImages,
    uploading,
    error,
    addImage,
    addImageFromPath,
    removeImage,
    clearImages,
    clearError,
    uploadUnuploaded,
  };
}
