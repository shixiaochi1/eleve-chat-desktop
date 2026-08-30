import { useRef, useCallback, useEffect, useState, memo } from 'react';
import { completePath } from '../utils/api';
import CommandMenu from './CommandMenu';
import ModelPill from './ModelPill';
import AttachMenu from './AttachMenu';
import GoalBar from './GoalBar';
import VoiceActivityBar from './VoiceActivityBar';
import ThinkingButton from './ThinkingButton';
import FastModeButton from './FastModeButton';
import WebWindowButton from './WebWindowButton';
import SlashCommandPopup from './SlashCommandPopup';
import QueuePanel from './QueuePanel';
import { SendIcon, MicIcon, LoadingIcon } from './Icons';
import { WakeWordButton } from './WakeWordButton';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoice } from '@/hooks/useVoice';
import { getWsClient } from '@/services/ws-client';
import { mimeFromExt, arrayBufferToBase64 } from '@/utils/file';
import { isRemoteMode, loadConnection } from '@/lib/connection';
import { useSlashAutocomplete } from '@/hooks/useSlashAutocomplete';

import { useBackendQueue, type QueueEntry } from '@/hooks/useBackendQueue';
import { setMessages as storeSetMessages } from '../store/messages';
import { applyQueueEditToBubbles, applyQueueRemoveToBubbles } from '../lib/queue-bubble-sync';
import { onComposerInsertRequest, LINE_REF_MIME, fileLineRef } from '@/lib/composer-events';
import { dragHasPaths, collectDroppedPaths } from '@/lib/paths-dnd';
import { linkifyUrls, rewriteTypedUrl, formatRefValue } from '@/lib/url-refs';

interface InputAreaProps {
  onSend?: (text: string) => void;
  onCommand?: (cmdName: string, args: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  portReady?: boolean;
  portVersion?: string;
  /** 添加图片（粘贴/拖拽/选择时调用） */
  onAddImage?: (file: File) => Promise<void>;
  /** 添加图片（Tauri 本地路径，image.attach 快路径 / remote attach_bytes） */
  onAddImageFromPath?: (path: string) => Promise<void>;
  /** 🔴 2026-08-20：是否已挂载图片附件——纯图片（无文字）也可发送（对齐 Hermes：图片可独立提交） */
  hasAttachments?: boolean;
  /** 当前会话 ID — 附件 RPC 显式传参（禁止 fallback ws-client 全局，profile 切换瞬间全局可能是目标 Agent） */
  sessionId?: string | null;
  /** 🔴 W-6：会话 cwd（session.info 推送）— 透传给 complete.path 作补全基准目录 */
  sessionCwd?: string;
}

/**
 * 输入区 — Hermes 式容器化 Composer（对齐 Hermes Desktop，阶段一）
 *
 * 结构：[透明输入区] + [控制行] 共处一个玻璃质感容器表面
 * （🔴 2026-08-09 图片附件预览条已移至聊天区底部，InputArea 只保留事件捕获）
 * - 容器表面：.composer-surface（rounded-2xl + border + 玻璃填充，hover/focus-within 梯度反馈）
 * - 控制行：[≡ 命令菜单] [📎 附件] … [高对比圆形发送/停止键]
 * - 发送键：bg-foreground 圆形 + arrow-up（Hermes PRIMARY CTA），空内容置灰，按压缩放
 *
 * 保留能力（一个不丢）：
 * - [≡] CommandMenu 命令菜单、📎 图片附件全链路（粘贴/拖拽/选择/预览/删除）
 * - `/` 命令补全弹窗（现锚定在容器表面上方）
 * - textarea 自动调高 + Enter 发送 / Shift+Enter 换行 / 排队提示
 *
 * 图片附件架构（对齐 Hermes Desktop）：
 * - UI 层：InputArea 只负责事件捕获（粘贴/拖拽/选择），预览渲染在聊天区底部（App.tsx）
 * - 状态层：useImageAttachments 管理 attachedImages 状态 + WS 调用
 * - 传输层：ws-client.ts 的 imageAttachBytes/imageDetach
 * - 后端：image.attach_bytes 写入磁盘 + session.attached_images
 *
 * 图片生命周期：用户操作 → onAddImage → useImageAttachments.addImage → ws-client.imageAttachBytes
 *                → 后端存储 → 返回 path → 本地状态更新 → 聊天区底部预览渲染（App.tsx）
 * 发送时后端自动 drain：prompt.submit → run_stream_with_trace → 消费 attached_images
 */
function InputArea({
  onSend,
  onCommand,
  onAbort,
  isStreaming,
  portReady,
  portVersion,
  onAddImage,
  onAddImageFromPath,
  sessionId,
  sessionCwd,
  hasAttachments,
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // `/` 命令补全 — 共享 hook（与宫格 AgentCardComposer 同一权威源）
  const slash = useSlashAutocomplete({ enabled: !!portReady, refreshKey: portVersion });
  /** 输入框是否有内容 — 驱动发送键的置灰态（仅布尔翻转时触发渲染） */
  const [hasText, setHasText] = useState(false);

  // ── 排队编辑（对齐 Hermes use-composer-queue: beginQueuedEdit / stepQueuedEdit / exitQueuedEdit）
  // 🔴 2026-08-16 方案A：队列数据源 = 后端权威投影（queue.status 轮询），
  // 编辑/删除/立即发送走 queue.edit / queue.remove / queue.steer RPC
  const { queue: queueEntries, subagentActive, edit: queueEditEntry, remove: queueRemove, steer: queueSteer } = useBackendQueue(sessionId);
  const [queueEdit, setQueueEdit] = useState<{ entryIndex: number; draft: string } | null>(null);
  // 🔴 2026-08-15 DSH QueueDock 对齐：排队改为控制行按钮 + 容器内向上弹出面板
  // （老大需求）。原常驻展开面板改为按需开合；有编辑/新排队时自动展开。
  const [queueOpen, setQueueOpen] = useState(false);
  const queueCount = queueEntries.length;
  const prevQueueCountRef = useRef(queueCount);
  useEffect(() => {
    // 新条目入队 → 自动展开（DSH QueueDock：interaction 驱动）
    if (queueCount > 0 && prevQueueCountRef.current === 0) setQueueOpen(true);
    // 清空 → 自动收起
    if (queueCount === 0) setQueueOpen(false);
    prevQueueCountRef.current = queueCount;
  }, [queueCount]);
  useEffect(() => {
    // 进入编辑态时确保面板展开（beginQueueEdit 从面板外触发也能看到条目）
    if (queueEdit) setQueueOpen(true);
  }, [queueEdit]);
  // 排队弹层点击外部关闭（DSH QueueDock closeOutside 语义）
  const queuePopupRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!queueOpen || queueEdit) return; // 编辑中不自动收起
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // 排除开合按钮本身——toggle 负责开关，否则 mousedown 先关、click 再开，按钮关不掉面板
      if (t.closest('[data-queue-toggle]')) return;
      if (queuePopupRef.current && !queuePopupRef.current.contains(t)) {
        setQueueOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [queueOpen, queueEdit]);

  const syncHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  const beginQueueEdit = useCallback((entry: QueueEntry) => {
    const el = inputRef.current;
    if (!el || queueEdit) return;
    setQueueEdit({ entryIndex: entry.index, draft: el.value });
    el.value = entry.text;
    syncHeight();
    el.focus();
  }, [queueEdit, syncHeight]);

  const stepQueueEdit = useCallback((direction: -1 | 1): boolean => {
    if (!queueEdit) return false;
    const el = inputRef.current;
    if (!el) return false;
    const index = queueEntries.findIndex((e) => e.index === queueEdit.entryIndex);
    const target = index + direction;
    if (index < 0 || target < 0) return index >= 0; // 最顶部：吞掉
    // 保存当前编辑（后端 queue.edit RPC，轮询自动刷新）
    // 🔴 2026-08-16（审计 C2）：编辑成功后同步聊天区乐观气泡文本（busy 直发
    //   时前端乐观上屏的气泡仍显示旧文本）；expected_text CAS 防快照漂移
    const save = async () => {
      const current = el.value;
      if (!current.trim()) return;
      const entry = queueEntries.find((e) => e.index === queueEdit.entryIndex);
      const oldText = entry?.text ?? '';
      const ok = await queueEditEntry(queueEdit.entryIndex, current, oldText);
      if (ok && entry) {
        storeSetMessages((prev) =>
          applyQueueEditToBubbles(prev, { oldText, newText: current, mediaCount: entry.media_count }) ?? prev,
        );
      }
    };
    void save();
    const next = queueEntries[target];
    if (next) {
      setQueueEdit({ ...queueEdit, entryIndex: next.index });
      el.value = next.text;
    } else {
      // 越过末条：退出编辑，恢复原草稿（对齐 Hermes stepQueuedEdit）
      setQueueEdit(null);
      el.value = queueEdit.draft;
    }
    syncHeight();
    el.focus();
    return true;
  }, [queueEdit, queueEntries, queueEditEntry, syncHeight]);

  const exitQueueEdit = useCallback((action: 'save' | 'cancel'): boolean => {
    if (!queueEdit) return false;
    const el = inputRef.current;
    if (!el) return false;
    if (action === 'save') {
      const text = el.value;
      if (!text.trim()) return false; // 空内容不保存
      // 🔴 2026-08-16（审计 C2）：同 stepQueueEdit——编辑成功同步乐观气泡
      const entry = queueEntries.find((e) => e.index === queueEdit.entryIndex);
      const oldText = entry?.text ?? '';
      void (async () => {
        const ok = await queueEditEntry(queueEdit.entryIndex, text, oldText);
        if (ok && entry) {
          storeSetMessages((prev) =>
            applyQueueEditToBubbles(prev, { oldText, newText: text, mediaCount: entry.media_count }) ?? prev,
          );
        }
      })();
    }
    setQueueEdit(null);
    el.value = queueEdit.draft;
    syncHeight();
    el.focus();
    return true;
  }, [queueEdit, queueEntries, queueEditEntry, syncHeight]);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // F3 T3.1: @ 路径补全
  const [pathItems, setPathItems] = useState<Array<{ text: string; display: string; meta: string }>>([]);
  const [showPathPopup, setShowPathPopup] = useState(false);
  const [pathSelectedIndex, setPathSelectedIndex] = useState(0);
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value || '';
    // 🔴 2026-08-20：纯图片（无文字）也可发送——有附件即放行（对齐 Hermes 图片独立提交）
    if (!text.trim() && !hasAttachments) return;
    onSend?.(text);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setHasText(false);
    slash.close();
  }, [onSend, slash, hasAttachments]);

  const handleCommandExec = useCallback((cmdName: string, args = '') => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setHasText(false);
    slash.close();
    onCommand?.(cmdName, args);
  }, [onCommand, slash]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 🔴 排队编辑键盘（对齐 Hermes stepQueuedEdit：↑↓遍历 / Escape 取消 / Enter 保存）
    if (queueEdit) {
      if (e.key === 'ArrowUp') { e.preventDefault(); stepQueueEdit(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); stepQueueEdit(1); return; }
      if (e.key === 'Escape') { e.preventDefault(); exitQueueEdit('cancel'); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); exitQueueEdit('save'); return; }
    }

    // F3 T3.1: @ 路径补全弹窗键盘导航
    if (showPathPopup && pathItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPathSelectedIndex(i => (i + 1) % pathItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPathSelectedIndex(i => (i - 1 + pathItems.length) % pathItems.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const item = pathItems[pathSelectedIndex];
        if (item && inputRef.current) {
          const el = inputRef.current;
          const cursorPos = el.selectionStart ?? el.value.length;
          const textBeforeCursor = el.value.slice(0, cursorPos);
          const textAfterCursor = el.value.slice(cursorPos);
          // 🔴 2026-08-09 对齐 Hermes 引用形态：后端补全产物已是完整 @file:/@folder: 引用
          // （含前缀），替换起点必须回到 @ 而非最后一个空格——否则 "@file @file:xxx" 双重前缀
          const atPos = textBeforeCursor.lastIndexOf('@');
          const prefix = atPos >= 0 ? textBeforeCursor.slice(0, atPos) : '';
          el.value = prefix + item.text + ' ' + textAfterCursor;
          el.selectionStart = el.selectionEnd = prefix.length + item.text.length + 1;
          setShowPathPopup(false);
          setPathItems([]);
          el.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowPathPopup(false);
        return;
      }
    }

    if (slash.showPopup && slash.filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slash.moveSelection(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slash.moveSelection(-1);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const cmd = slash.activeCommand;
        if (cmd) {
          const currentValue = inputRef.current?.value || '';
          const argsPart = currentValue.replace(/^\/\S*\s*/, ' ').trim();
          const newValue = `/${cmd.name}` + (argsPart ? ' ' + argsPart : '');

          if (inputRef.current) {
            inputRef.current.value = newValue;
          }

          if (e.key === 'Enter') {
            handleCommandExec(cmd.name, argsPart);
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slash.close();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // 🔴 手输 URL 按空格 → 光标前完整 URL 改写成 @url: directive（对齐 Hermes chipTypedUrlOnSpace）
    if (e.key === ' ' && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const el = inputRef.current;
      if (el) {
        const caret = el.selectionStart ?? el.value.length;
        const rewrite = rewriteTypedUrl(el.value.slice(0, caret));
        if (rewrite) {
          el.value = rewrite.before + el.value.slice(caret);
          el.selectionStart = el.selectionEnd = rewrite.caret;
          // 最小同步（handleInput 声明在后不可引用）：高度 + hasText
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 150) + 'px';
          const nextHasText = el.value.trim().length > 0;
          setHasText((prev) => (prev === nextHasText ? prev : nextHasText));
          // 不 preventDefault：空格继续自然输入
        }
      }
    }
  }, [showPathPopup, pathItems, pathSelectedIndex, slash, handleSend, handleCommandExec, queueEdit, stepQueueEdit, exitQueueEdit]);

  const handleInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';

    // 同步 hasText（仅布尔翻转才 setState，避免每次按键重渲染）
    const nextHasText = el.value.trim().length > 0;
    setHasText(prev => (prev === nextHasText ? prev : nextHasText));

    const val = el.value;
    // F3: 提取光标处当前词（支持 @ 在文本中间）
    const cursorPos = el.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const currentWord = textBeforeCursor.split(/\s/).pop() || '';

    if (slash.syncFromValue(val)) {
      // slash 模式 — 关闭 @ 路径弹窗
      setShowPathPopup(false);
    } else if (currentWord.startsWith('@') && currentWord.length >= 2) {
      // F3 T3.1: @ 路径补全 — debounce 200ms 调后端
      if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current);
      pathDebounceRef.current = setTimeout(async () => {
        try {
          const res = await completePath(currentWord, sessionCwd);
          setPathItems(res.items || []);
          setPathSelectedIndex(0);
          setShowPathPopup((res.items || []).length > 0);
        } catch {
          setShowPathPopup(false);
        }
      }, 200);
    } else {
      setShowPathPopup(false);
    }
    // 🔴 W-6：sessionCwd 必须在依赖里——补全闭包捕获会话 cwd，
    // 会话切换/session.info 到达后要用新值（漏了 = 捕获过期 cwd）
  }, [slash, sessionCwd]);

  // ── 语音输入 + 链接插入：向光标处写入文本 ──

  /** 在光标处插入文本（语音转录与链接共用），随后同步高度/状态 */
  const insertTextAtCursor = useCallback((text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    handleInput();
    el.focus();
  }, [handleInput]);

  const voice = useVoice({ onTranscript: insertTextAtCursor });

  const handleAddUrl = useCallback((url: string) => {
    // 对齐 Hermes use-composer-url-dialog fallback：@url: directive 注入（后端展开网页内容）
    insertTextAtCursor('@url:' + formatRefValue(url) + ' ');
  }, [insertTextAtCursor]);

  // 原生对话框选中的文件/文件夹路径 — 插入输入框（对齐 Hermes 附件路径入输入区语义）
  const handleAddPaths = useCallback((paths: string[]) => {
    insertTextAtCursor(paths.join(' ') + ' ');
  }, [insertTextAtCursor]);

  // Tauri 对话框图片路径 → 逐个走快路径（本地 image.attach / remote attach_bytes）
  const handlePickImagePaths = useCallback(async (paths: string[]) => {
    if (!onAddImageFromPath) return;
    for (const p of paths) {
      try {
        await onAddImageFromPath(p);
      } catch (err) {
        console.error('[InputArea] Add image from path failed:', err);
      }
    }
  }, [onAddImageFromPath]);

  // 文件附件 → file.attach staging（对齐 Hermes uploadComposerAttachment 文件分支）：
  // 本地模式传 path（后端三 case：workspace 内直用 / 外复制 / 不存在才要 data_url）；
  // remote 模式读文件字节 data_url 上传（后端看不到客户端路径）；ref_text 注入输入框。
  const handleAttachFiles = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      try {
        const conn = loadConnection();
        const remote = isRemoteMode(conn);
        const ws = getWsClient();
        const name = path.split(/[\\/]/).pop() || 'attachment';
        let result;
        if (remote) {
          const { readFile } = await import('@tauri-apps/plugin-fs');
          const bytes = await readFile(path);
          const mime = mimeFromExt(path) ?? 'application/octet-stream';
          result = await ws.fileAttach({ path, data_url: `data:${mime};base64,${arrayBufferToBase64(bytes)}`, name, sessionId: sessionId ?? undefined });
        } else {
          result = await ws.fileAttach({ path, name, sessionId: sessionId ?? undefined });
        }
        if (result.attached && result.ref_text) {
          insertTextAtCursor(result.ref_text + ' ');
        } else {
          console.warn('[InputArea] file attach failed:', path);
          import('../utils/notifications').then(({ notifyError }) => {
            notifyError(`文件附件失败: ${name}（后端未确认）`, '附件失败');
          });
        }
      } catch (err) {
        console.warn('[InputArea] file attach error:', err);
        import('../utils/notifications').then(({ notifyError }) => {
          notifyError(`文件附件失败: ${err instanceof Error ? err.message : String(err)}`, '附件失败');
        });
      }
    }
  }, [insertTextAtCursor, sessionId]);

  // ── 预览控制台“发送到输入区”（对齐 Hermes focus.ts 总线：外部面板 → composer）──
  // 订阅 window CustomEvent，复用 insertTextAtCursor（零重复逻辑）；卸载自动取消
  useEffect(() => onComposerInsertRequest(insertTextAtCursor), [insertTextAtCursor]);

  // ── 图片附件：粘贴 / 拖拽 / 文件选择 ──

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    // 图片粘贴优先（现状逻辑）
    if (onAddImage) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            void onAddImage(file).catch((err) => {
              console.error('[InputArea] Paste image failed:', err);
            });
          }
          return;
        }
      }
    }
    // 🔴 URL 文本粘贴 → 裸链接改写成 @url: directive（对齐 Hermes linkifyUrls）
    const text = e.clipboardData.getData('text/plain');
    if (text && /https?:\/\//i.test(text)) {
      const linked = linkifyUrls(text);
      if (linked !== text) {
        e.preventDefault();
        insertTextAtCursor(linked);
      }
    }
  }, [onAddImage, insertTextAtCursor]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    // 行级引用拖拽（源码视图 gutter 拖出；对齐 Hermes HERMES_PATHS_MIME → composer ref）
    if (Array.from(e.dataTransfer.types).includes(LINE_REF_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const parsed = JSON.parse(e.dataTransfer.getData(LINE_REF_MIME)) as {
          path?: string;
          start?: number;
          end?: number;
        };
        if (parsed.path && typeof parsed.start === 'number') {
          insertTextAtCursor(fileLineRef(parsed.path, parsed.start, parsed.end) + ' ');
        }
      } catch { /* 静默 */ }
      return;
    }
    // 文件树路径拖入（对齐 Hermes composer use-composer-drop：in-app 路径 → 引用插入）
    if (dragHasPaths(e.dataTransfer)) {
      const paths = collectDroppedPaths(e.dataTransfer);
      if (paths.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertTextAtCursor(paths.map((p) => `@file:"${p}"`).join(' ') + ' ');
      }
      return;
    }
    if (!onAddImage) return;
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    // 🔴 2026-08-08 阻止冒泡：chat-area 层也有图片 drop 处理（消息区拖入），
    // 不 stop 会导致图片双份附加
    e.stopPropagation();
    for (const file of imageFiles) {
      try {
        await onAddImage(file);
      } catch (err) {
        console.error('[InputArea] Drop image failed:', err);
      }
    }
  }, [onAddImage, insertTextAtCursor]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(LINE_REF_MIME) || dragHasPaths(e.dataTransfer) || (onAddImage && types.includes('Files'))) {
      e.preventDefault();
    }
  }, [onAddImage]);

  const handleFileSelect = useCallback(() => {
    if (!onAddImage) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      for (const file of files) {
        try {
          await onAddImage(file);
        } catch (err) {
          console.error('[InputArea] File select failed:', err);
        }
      }
    };
    input.click();
  }, [onAddImage]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        slash.close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [slash]);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  // N6: 录音快捷键全局监听（对齐 Hermes _voice_record_key → Ctrl+B）。
  // record_key 从后端 voice.toggle status 读取（走 CONFIG，不硬编码），
  // 挂载时读一次；解析 "ctrl+b" / "ctrl+shift+x" 形式的组合键。
  const voiceToggleRef = useRef(voice.toggle);
  voiceToggleRef.current = voice.toggle;
  useEffect(() => {
    let combo = 'ctrl+b'; // 默认对齐 Hermes
    let cancelled = false;
    const ws = getWsClient();
    ws.voiceToggle('status')
      .then((r) => {
        if (!cancelled && r.record_key) combo = r.record_key;
      })
      .catch(() => {});

    const parse = (spec: string) => {
      const parts = spec.toLowerCase().split('+').map((s) => s.trim());
      const key = parts.pop() || '';
      return {
        key,
        ctrl: parts.includes('ctrl') || parts.includes('control'),
        shift: parts.includes('shift'),
        alt: parts.includes('alt'),
      };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const cur = parse(combo);
      const keyNorm = e.key.toLowerCase();
      const hit =
        keyNorm === cur.key &&
        e.ctrlKey === cur.ctrl &&
        e.shiftKey === cur.shift &&
        e.altKey === cur.alt;
      if (!hit) return;
      e.preventDefault();
      void voiceToggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="p-3">
      {/* 🔴 2026-08-18 老大调整：TodoPanel 迁出 InputArea——任务计划改挂
          在 ContextBar（新建/宫格按钮行）上方，见 App.tsx；此处仅保留
          GoalBar 与 composer 的底部 dock 顺序。 */}
      {/* 🔴 2026-08-15 DSH GoalBar 对齐：进行中目标显示框（/goal 设定）。
          普通文档流（非 overlay）：消息区 → 附件缩略图 → 本框 → 输入框，
          天然不挡消息；附件缩略图在本框之上（App.tsx 附件条在 InputArea 之前渲染）。
          排队面板改由下方控制行按钮开合（DSH QueueDock 对齐，老大需求）。 */}
      <GoalBar sessionId={sessionId} />

      {/* Hermes 式容器表面 — 输入区在上，控制行在下 */}
      <div className="composer-surface relative rounded-2xl border">
        {/* 🔴 2026-08-15 排队消息弹层（DSH QueueDock 对齐）：控制行按钮开合，
            容器内向上弹出（与 @ 路径补全弹窗同锚定模式）。 */}
        {queueEntries.length > 0 && queueOpen && (
          <div
            ref={queuePopupRef}
            className="absolute inset-x-0 bottom-full z-50 mb-1.5"
          >
            <QueuePanel
              entries={queueEntries}
              busy={!!isStreaming}
              subagentActive={subagentActive}
              editingId={queueEdit?.entryIndex ?? null}
              onDelete={(index) => {
                // 🔴 P3-3：编辑态激活时先退出（恢复草稿）——删除导致后续行 index
                // 前移，残留 queueEdit.entryIndex 会指向错行
                if (queueEdit) exitQueueEdit('cancel');
                // 🔴 2026-08-16（审计 C2）：删除成功后移除聊天区乐观气泡
                // （防残留无回复气泡）；expected_text CAS 防快照漂移删错条目
                const entry = queueEntries[index];
                void (async () => {
                  const ok = await queueRemove(index, entry?.text ?? '');
                  if (ok && entry) {
                    storeSetMessages((prev) =>
                      applyQueueRemoveToBubbles(prev, { text: entry.text, mediaCount: entry.media_count }) ?? prev,
                    );
                  }
                })();
              }}
              onEdit={beginQueueEdit}
              onSendNow={(index) => {
                // 🔴 P3-3：同删除——steer 移除条目同样引起 index 漂移
                if (queueEdit) exitQueueEdit('cancel');
                void queueSteer(index);
              }}
            />
          </div>
        )}
        {/* `/` 命令补全弹窗 — 共享 SlashCommandPopup，锚定在容器表面上方 */}
        <div ref={popupRef}>
          {slash.showPopup && (
            <SlashCommandPopup
              items={slash.filtered}
              selectedIndex={slash.selectedIndex}
              onHover={slash.setSelectedIndex}
              onPick={(cmd) => {
                const args = inputRef.current?.value.replace(/^\/\S+\s*/, '') || '';
                handleCommandExec(cmd.name, args);
              }}
            />
          )}
        </div>

        {/* F3 T3.1: @ 路径补全弹窗 */}
        {showPathPopup && pathItems.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-[var(--ui-stroke-tertiary)] bg-popover p-1 shadow-lg">
            {pathItems.map((item, i) => (
              <div
                key={item.text}
                className={cn(
                  'px-3 py-1.5 text-sm cursor-pointer rounded-md flex items-center gap-2',
                  i === pathSelectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
                onMouseEnter={() => setPathSelectedIndex(i)}
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  const el = inputRef.current;
                  if (!el) return;
                  const cursorPos = el.selectionStart ?? el.value.length;
                  const textBeforeCursor = el.value.slice(0, cursorPos);
                  const textAfterCursor = el.value.slice(cursorPos);
                  const lastSpace = textBeforeCursor.lastIndexOf(' ');
                  const prefix = lastSpace >= 0 ? textBeforeCursor.slice(0, lastSpace + 1) : '';
                  el.value = prefix + item.text + ' ' + textAfterCursor;
                  el.selectionStart = el.selectionEnd = prefix.length + item.text.length + 1;
                  setShowPathPopup(false);
                  setPathItems([]);
                  el.focus();
                }}
              >
                <span className="font-mono text-xs text-foreground">{item.display}</span>
                {item.meta && (
                  <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">{item.meta}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-(--composer-row-gap) px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
          {/* 语音活动状态条 — 录音/转录时显示（对齐 Hermes VoiceActivity） */}
          {voice.status !== 'idle' && (
            <VoiceActivityBar
              status={voice.status}
              elapsed={voice.elapsed}
              onCancel={() => { void voice.toggle(); }}
            />
          )}

          {/* 输入区 — 透明背景、无边框，chrome 质感由容器表面统一承载 */}
          <textarea
            ref={inputRef}
            id="input"
            className="max-h-(--composer-input-max-height) min-h-(--composer-input-min-height) w-full resize-none border-0 bg-transparent px-1 pb-0.5 pt-1 text-sm leading-normal outline-none placeholder:text-muted-foreground/60"
            placeholder={isStreaming ? '输入消息排队等待… (Enter 发送)' : '向 Eleve 发送消息… (Enter 发送, / 命令)'}
            rows={1}
            autoComplete="off"
            spellCheck="false"
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          />

          {/* 控制行 — 对齐 Hermes：命令/附件/语音/模型/思考深度/快速模式/上下文文件/网页窗口 在左，发送在右 */}
          <div className="flex items-center gap-(--composer-control-gap)">
            <CommandMenu commands={slash.commands} onCommand={handleCommandExec} />
            {/* 附件 "+" 菜单 — Hermes 式附件入口（图片接通后端、链接纯前端、文件/文件夹接通 Tauri 原生对话框） */}
            {onAddImage && <AttachMenu onPickImage={handleFileSelect} onPickImagePaths={handlePickImagePaths} onAttachFiles={handleAttachFiles} onAddUrl={handleAddUrl} onAddPaths={handleAddPaths} />}
            {/* 🔴 2026-08-15 排队消息按钮（DSH QueueDock 对齐，老大需求：按钮放输入框上的按钮栏）
                —— 有排队条目时显示；点击开合容器内向上弹出的排队面板 */}
            {queueEntries.length > 0 && (
              <button
                type="button"
                data-queue-toggle
                onClick={() => setQueueOpen((v) => !v)}
                className={cn(
                  'inline-flex size-(--composer-control-size) shrink-0 items-center justify-center rounded-md transition-colors duration-150 relative',
                  queueOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                title={queueOpen ? '收起排队消息' : `排队消息（${queueEntries.length}）`}
                aria-label={`排队消息（${queueEntries.length}）`}
                aria-expanded={queueOpen}
              >
                <Layers size={15} />
                {/* 计数角标 */}
                <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-primary text-background text-[9px] leading-[14px] text-center">
                  {queueEntries.length}
                </span>
              </button>
            )}
            {/* 麦克风 — P4 解禁：后端 voice.record 已真实接线（VAD 录音 + 静音自动停止 + 转录回推） */}
            <button
              type="button"
              onClick={() => { void voice.toggle(); }}
              className={cn(
                'inline-flex size-(--composer-control-size) shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                voice.status === 'recording'
                  ? 'bg-destructive/15 text-destructive'
                  : voice.status === 'transcribing'
                    ? 'text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              title={voice.status === 'recording' ? '点击停止录音' : voice.status === 'transcribing' ? '转录中…' : '语音输入'}
              aria-label={voice.status === 'recording' ? '停止录音' : '语音输入'}
            >
              {voice.status === 'transcribing' ? <LoadingIcon size={15} /> : <MicIcon size={15} />}
            </button>
            {/* 唤醒词耳朵开关 — 对齐 Hermes composer WakeWordButton（persist 显式手势翻配置） */}
            <WakeWordButton pausedForVoice={voice.status === 'recording'} />
            {/* 模型胶囊 — 模型显示 + 分组下拉切换（Hermes 式 Model Pill） */}
            <ModelPill />
            {/* 思考深度 — 低/中/高，config.set 持久化（对齐 Hermes reasoning_effort） */}
            <ThinkingButton />
            {/* 快速模式 — 开关（对齐 Hermes fastMode = agent.service_tier fast，已接线后端透传） */}
            <FastModeButton />
            {/* 网页窗口 — 已接通后端 browser.manage（连接/断开浏览器） */}
            <WebWindowButton sessionId={sessionId} />
            <div className="ml-auto flex items-center gap-(--composer-control-gap)">
              {/* 发送/停止 — Hermes 式高对比圆形主按钮：黑底白箭头(亮色态)/白底黑箭头(暗色态) */}
              <button
                className={cn(
                  'inline-flex size-(--composer-control-primary-size) shrink-0 cursor-pointer items-center justify-center rounded-full p-0 outline-none transition-all duration-150',
                  'bg-foreground text-background hover:bg-foreground/90 active:scale-90',
                  'disabled:cursor-not-allowed disabled:bg-foreground/30 disabled:opacity-100 disabled:active:scale-100'
                )}
                id="send-btn"
                title={isStreaming ? '停止生成' : '发送'}
                aria-label={isStreaming ? 'Stop generation' : 'Send message'}
                disabled={!isStreaming && !hasText && !hasAttachments}
                onClick={isStreaming ? onAbort : handleSend}
              >
                {isStreaming ? (
                  <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
                ) : (
                  <SendIcon size={16} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(InputArea);
