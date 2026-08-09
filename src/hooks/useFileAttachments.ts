/**
 * useFileAttachments — 文件附件状态管理（🔴 2026-08-09 新增，对齐 Hermes uploadComposerAttachment 文件分支）
 *
 * 场景：右侧文件树拖文件到聊天区 → 像图片一样在附件条显示（文件 pill），发送时注入 ref_text。
 *
 * 对齐 Hermes 语义：
 * - file.attach staging（后端三 case：workspace 内直用 / 外复制 / 不存在才要 data_url），
 *   返回 ref_text（`@file:相对路径`）→ 发送时合并进 prompt 文本（Hermes attachment.refText 语义）
 * - 图片路径不归本 hook（走 useImageAttachments 缩略图）
 * - 不 eager 上传（对齐 Hermes "not eager-uploaded"：attach 即 staging，无额外上传）
 */

import { useState, useCallback, useRef } from 'react';
import { getWsClient } from '@/services/ws-client';
import { loadConnection, isRemoteMode } from '@/lib/connection';
import { mimeFromExt, arrayBufferToBase64 } from '@/utils/file';

export interface AttachedFile {
  /** 本地唯一 ID（React key + 删除定位） */
  id: string;
  /** 后端存储路径（file.attach 返回） */
  path: string;
  /** 文件名（显示用） */
  name: string;
  /** 注入 prompt 的引用文本（@file:相对路径） */
  refText: string;
  /** 是否已复制进 workspace（false = workspace 内直用） */
  uploaded: boolean;
}

/** 最多同时附加的文件数（内存/文本保护，对齐图片 MAX_IMAGES 精神） */
const MAX_FILES = 10;

export function useFileAttachments(options?: {
  /** per-agent 场景：返回当前目标 session_id（空则走全局 this.sessionId） */
  getSessionId?: () => string | null | undefined;
}) {
  const getSessionIdRef = useRef(options?.getSessionId);
  getSessionIdRef.current = options?.getSessionId;
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 附加中的文件数（UI spinner） */
  const [attaching, setAttaching] = useState(0);
  const attachingPaths = useRef<Set<string>>(new Set());

  const clearError = useCallback(() => setError(null), []);

  /** 从本地路径附加文件 — 对齐 Hermes uploadComposerAttachment 文件分支：
   * 本地模式 → file.attach 路径引用（后端三 case staging）；
   * remote 模式 → 读文件字节 data_url 上传（后端看不到客户端路径）。
   */
  const attachPaths = useCallback(async (paths: string[]): Promise<boolean> => {
    if (paths.length === 0) return true;
    if (attachedFiles.length >= MAX_FILES) {
      setError(`最多附加 ${MAX_FILES} 个文件`);
      return false;
    }
    const ws = getWsClient();
    const sessionId = getSessionIdRef.current?.() ?? undefined;
    const conn = loadConnection();
    const remote = isRemoteMode(conn);
    let allOk = true;
    setAttaching((n) => n + paths.length);

    for (const path of paths) {
      // 防重复附加同一路径（拖拽重入）
      if (attachingPaths.current.has(path)) continue;
      attachingPaths.current.add(path);
      try {
        const name = path.split(/[\\/]/).pop() || 'attachment';
        let result;
        if (remote) {
          const { readFile } = await import('@tauri-apps/plugin-fs');
          const bytes = await readFile(path);
          const mime = mimeFromExt(path) ?? 'application/octet-stream';
          result = await ws.fileAttach({
            path,
            data_url: `data:${mime};base64,${arrayBufferToBase64(bytes)}`,
            name,
            sessionId,
          });
        } else {
          result = await ws.fileAttach({ path, name, sessionId });
        }
        if (result.attached && result.ref_text) {
          setAttachedFiles((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              path: result.path || path,
              name: result.name || name,
              refText: result.ref_text as string,
              uploaded: result.uploaded ?? false,
            },
          ]);
        } else {
          allOk = false;
          setError(`文件附件失败: ${name}（后端未确认）`);
        }
      } catch (err) {
        allOk = false;
        setError(`文件附件失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        attachingPaths.current.delete(path);
        setAttaching((n) => Math.max(0, n - 1));
      }
    }
    return allOk;
  }, [attachedFiles.length]);

  /** 移除附件（file.attach 无 detach 语义——staging 文件留在 workspace，仅清本地状态） */
  const removeFile = useCallback((id: string): void => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    setAttachedFiles([]);
    setError(null);
  }, []);

  return {
    attachedFiles,
    attaching,
    error,
    attachPaths,
    removeFile,
    clearFiles,
    clearError,
  };
}
