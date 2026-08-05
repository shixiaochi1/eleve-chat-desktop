import { useRef, useCallback, useEffect, useState, memo } from 'react';
import { completePath } from '../utils/api';
import CommandMenu from './CommandMenu';
import ModelPill from './ModelPill';
import AttachMenu from './AttachMenu';
import VoiceActivityBar from './VoiceActivityBar';
import ThinkingButton from './ThinkingButton';
import FastModeButton from './FastModeButton';
import WebWindowButton from './WebWindowButton';
import SlashCommandPopup from './SlashCommandPopup';
import QueuePanel from './QueuePanel';
import { SendIcon, MicIcon, LoadingIcon } from './Icons';
import { cn } from '@/lib/utils';
import type { AttachedImage } from '@/hooks/useImageAttachments';
import { useVoice } from '@/hooks/useVoice';
import { getWsClient } from '@/services/ws-client';
import { useSlashAutocomplete } from '@/hooks/useSlashAutocomplete';
import { useQueue, updateEntry, type QueuedMessage } from '@/lib/message-queue';
import { onComposerInsertRequest, LINE_REF_MIME, fileLineRef } from '@/lib/composer-events';

interface InputAreaProps {
  onSend?: (text: string) => void;
  onCommand?: (cmdName: string, args: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  portReady?: boolean;
  portVersion?: string;
  /** 已附加的图片列表（来自 useImageAttachments） */
  attachedImages?: AttachedImage[];
  /** 上传中状态（用于显示 loading） */
  imageUploading?: number;
  /** 图片上传错误信息 */
  imageError?: string | null;
  /** 添加图片（粘贴/拖拽/选择时调用） */
  onAddImage?: (file: File) => Promise<void>;
  /** 移除图片（点击删除按钮时调用） */
  onRemoveImage?: (id: string) => Promise<void>;
  /** 清除错误信息 */
  onClearImageError?: () => void;
  /** 队列键控 profile（对齐 Hermes activeQueueSessionKey） */
  queueProfile?: string;
  /** 🔴 W-6：会话 cwd（session.info 推送）— 透传给 complete.path 作补全基准目录 */
  sessionCwd?: string;
  /** 立即发送排队条目（对齐 Hermes sendQueuedNow） */
  onQueueSendNow?: (id: string) => void;
  /** 删除排队条目 */
  onQueueDelete?: (id: string) => void;
}

/**
 * 输入区 — Hermes 式容器化 Composer（对齐 Hermes Desktop，阶段一）
 *
 * 结构：[图片预览 / 提示] + [透明输入区] + [控制行] 共处一个玻璃质感容器表面
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
 * - UI 层：InputArea 只负责事件捕获和渲染预览
 * - 状态层：useImageAttachments 管理 attachedImages 状态 + WS 调用
 * - 传输层：ws-client.ts 的 imageAttachBytes/imageDetach
 * - 后端：image.attach_bytes 写入磁盘 + session.attached_images
 *
 * 图片生命周期：用户操作 → onAddImage → useImageAttachments.addImage → ws-client.imageAttachBytes
 *                → 后端存储 → 返回 path → 本地状态更新 → InputArea 预览渲染
 * 发送时后端自动 drain：prompt.submit → run_stream_with_trace → 消费 attached_images
 */
function InputArea({
  onSend,
  onCommand,
  onAbort,
  isStreaming,
  portReady,
  portVersion,
  attachedImages,
  imageUploading,
  imageError,
  onAddImage,
  onRemoveImage,
  onClearImageError,
  queueProfile,
  sessionCwd,
  onQueueSendNow,
  onQueueDelete,
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // `/` 命令补全 — 共享 hook（与宫格 AgentCardComposer 同一权威源）
  const slash = useSlashAutocomplete({ enabled: !!portReady, refreshKey: portVersion });
  /** 输入框是否有内容 — 驱动发送键的置灰态（仅布尔翻转时触发渲染） */
  const [hasText, setHasText] = useState(false);

  // ── 排队编辑（对齐 Hermes use-composer-queue: beginQueuedEdit / stepQueuedEdit / exitQueuedEdit）──
  const queueEntries = useQueue(queueProfile ?? '');
  const [queueEdit, setQueueEdit] = useState<{ entryId: string; draft: string } | null>(null);

  const syncHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  const beginQueueEdit = useCallback((entry: QueuedMessage) => {
    const el = inputRef.current;
    if (!el || queueEdit) return;
    setQueueEdit({ entryId: entry.id, draft: el.value });
    el.value = entry.text;
    syncHeight();
    el.focus();
  }, [queueEdit, syncHeight]);

  const stepQueueEdit = useCallback((direction: -1 | 1): boolean => {
    if (!queueEdit) return false;
    const el = inputRef.current;
    if (!el) return false;
    const index = queueEntries.findIndex((e) => e.id === queueEdit.entryId);
    const target = index + direction;
    if (index < 0 || target < 0) return index >= 0; // 最顶部：吞掉
    // 保存当前编辑
    if (queueProfile) updateEntry(queueProfile, queueEdit.entryId, { text: el.value });
    const next = queueEntries[target];
    if (next) {
      setQueueEdit({ ...queueEdit, entryId: next.id });
      el.value = next.text;
    } else {
      // 越过末条：退出编辑，恢复原草稿（对齐 Hermes stepQueuedEdit）
      setQueueEdit(null);
      el.value = queueEdit.draft;
    }
    syncHeight();
    el.focus();
    return true;
  }, [queueEdit, queueEntries, queueProfile, syncHeight]);

  const exitQueueEdit = useCallback((action: 'save' | 'cancel'): boolean => {
    if (!queueEdit) return false;
    const el = inputRef.current;
    if (!el) return false;
    if (action === 'save') {
      const text = el.value;
      if (!text.trim()) return false; // 空内容不保存
      if (queueProfile) updateEntry(queueProfile, queueEdit.entryId, { text });
    }
    setQueueEdit(null);
    el.value = queueEdit.draft;
    syncHeight();
    el.focus();
    return true;
  }, [queueEdit, queueProfile, syncHeight]);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // F3 T3.1: @ 路径补全
  const [pathItems, setPathItems] = useState<Array<{ text: string; display: string; meta: string }>>([]);
  const [showPathPopup, setShowPathPopup] = useState(false);
  const [pathSelectedIndex, setPathSelectedIndex] = useState(0);
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value || '';
    if (!text.trim()) return;
    onSend?.(text);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setHasText(false);
    slash.close();
  }, [onSend, slash]);

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
          // 替换当前 @word 为补全结果
          const lastSpace = textBeforeCursor.lastIndexOf(' ');
          const prefix = lastSpace >= 0 ? textBeforeCursor.slice(0, lastSpace + 1) : '';
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
    insertTextAtCursor(url + ' ');
  }, [insertTextAtCursor]);

  // 原生对话框选中的文件/文件夹路径 — 插入输入框（对齐 Hermes 附件路径入输入区语义）
  const handleAddPaths = useCallback((paths: string[]) => {
    insertTextAtCursor(paths.join(' ') + ' ');
  }, [insertTextAtCursor]);

  // ── 预览控制台“发送到输入区”（对齐 Hermes focus.ts 总线：外部面板 → composer）──
  // 订阅 window CustomEvent，复用 insertTextAtCursor（零重复逻辑）；卸载自动取消
  useEffect(() => onComposerInsertRequest(insertTextAtCursor), [insertTextAtCursor]);

  // ── 图片附件：粘贴 / 拖拽 / 文件选择 ──

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!onAddImage) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try {
            await onAddImage(file);
          } catch (err) {
            console.error('[InputArea] Paste image failed:', err);
          }
        }
        break;
      }
    }
  }, [onAddImage]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    // 行级引用拖拽（源码视图 gutter 拖出；对齐 Hermes HERMES_PATHS_MIME → composer ref）
    if (Array.from(e.dataTransfer.types).includes(LINE_REF_MIME)) {
      e.preventDefault();
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
    if (!onAddImage) return;
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
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
    if (types.includes(LINE_REF_MIME) || (onAddImage && types.includes('Files'))) {
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
      {/* 排队面板（对齐 Hermes QueuePanel：InputArea 上方，空队列不渲染） */}
      {queueProfile && (
        <QueuePanel
          entries={queueEntries}
          busy={!!isStreaming}
          editingId={queueEdit?.entryId ?? null}
          onDelete={(id) => onQueueDelete?.(id)}
          onEdit={beginQueueEdit}
          onSendNow={(id) => onQueueSendNow?.(id)}
        />
      )}

      {/* Hermes 式容器表面 — 图片预览/输入区在上，控制行在下 */}
      <div className="composer-surface relative rounded-2xl border">
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
          <div className="absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
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
          {/* 图片预览区 — 已附加的图片缩略图 + 删除按钮 */}
          {attachedImages && attachedImages.length > 0 && (
            <div className="flex gap-2 pt-1 flex-wrap items-start">
              {attachedImages.map(img => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.preview}
                    alt={img.name}
                    className="w-16 h-16 object-cover rounded-md border border-border"
                    draggable={false}
                  />
                  <button
                    onClick={() => onRemoveImage?.(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-primary-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                    title="移除图片"
                    aria-label={`Remove ${img.name}`}
                  >
                    ✕
                  </button>
                  <div className="text-xs text-muted-foreground truncate mt-1 max-w-[64px]" title={img.name}>
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 图片上传错误提示 */}
          {imageError && (
            <div className="flex items-center gap-2 mt-1 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
              <span className="flex-1 truncate">{imageError}</span>
              <button
                onClick={onClearImageError}
                className="shrink-0 hover:opacity-70"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* 上传中指示器 */}
          {(imageUploading ?? 0) > 0 && (
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              上传图片中… ({imageUploading})
            </div>
          )}

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
            {onAddImage && <AttachMenu onPickImage={handleFileSelect} onAddUrl={handleAddUrl} onAddPaths={handleAddPaths} />}
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
            {/* 模型胶囊 — 模型显示 + 分组下拉切换（Hermes 式 Model Pill） */}
            <ModelPill />
            {/* 思考深度 — 低/中/高，config.set 持久化（对齐 Hermes reasoning_effort） */}
            <ThinkingButton />
            {/* 快速模式 — 开关（对齐 Hermes fastMode，后端配置键待确认） */}
            <FastModeButton />
            {/* 网页窗口 — 已接通后端 browser.manage（连接/断开浏览器） */}
            <WebWindowButton />
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
                disabled={!isStreaming && !hasText}
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
