/**
 * AgentCardComposer — 宫格 per-Agent 输入行（全功能紧凑版）
 *
 * 设计（老大 2026-07-31 定稿）：
 *   单行 composer：[新建] [自动撑大 textarea] [📎附件] [🎤语音] [发送/停止] — 全部收进输入框内
 *   - 小卡片空间紧凑，严禁两行布局；按钮与 textarea 同行，随内容向上撑大
 *   - 新建会话用 SquarePen 图标（与附件 Plus 图标区分，避免视觉冲突）
 * - 输入框单行起、随内容向上自动撑大（max 120px，超出滚动）
 * - `/` 命令补全 — 与单视图 InputArea 共用 useSlashAutocomplete + SlashCommandPopup（零重复）
 * - 模型选择不在这里 — 放卡片顶部工具状态栏（ModelPill）
 * - 不要 DeepSeek（宫格场景用不上）
 * - 语音按钮 P4 解禁（后端 voice.record 已真实接线）；宫格紧凑场景按钮自身传达状态
 *   （录音=红、转录=spinner），不渲染 VoiceActivityBar（严禁两行布局）
 * - 图片附件 per-agent：useImageAttachments 经 getSessionId 绑到本 Agent 的 session
 *
 * 与 InputArea 的关系：共享 slash 补全权威源；布局/场景不同（宫格紧凑、无 @路径），
 * 各自持有键盘编排，不强行合并成单一组件（避免 prop 爆炸）。
 */
import { useState, useRef, useCallback, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { SquarePen } from 'lucide-react';
import { cn } from '@/lib/utils';
import AttachMenu from './AttachMenu';
import SlashCommandPopup from './SlashCommandPopup';
import { SendIcon, MicIcon } from './Icons';
import { WakeWordButton } from './WakeWordButton';
import { useSlashAutocomplete } from '@/hooks/useSlashAutocomplete';
import { useVoice } from '@/hooks/useVoice';
import type { AttachedImage } from '@/hooks/useImageAttachments';

/** 输入框向上撑大的最大高度（px），超出内部滚动 */
const MAX_INPUT_HEIGHT = 120;

interface AgentCardComposerProps {
  profileName: string;
  isStreaming: boolean;
  portReady: boolean;
  onSend: (text: string) => void;
  onCommand: (cmdName: string, args: string) => void;
  onAbort: () => void;
  onNewSession: () => void;
  /** per-agent 图片附件（useImageAttachments 实例，已绑本 Agent session） */
  attachedImages: AttachedImage[];
  imageUploading: number;
  onAddImage: (file: File) => Promise<unknown>;
  onRemoveImage: (id: string) => Promise<void>;
  /** 队列编辑状态（对齐 Hermes stepQueuedEdit / exitQueuedEdit） */
  queueEditingId?: string | null;
  onQueueStep?: (direction: -1 | 1) => { text: string; done: boolean } | null;
  onQueueExit?: (action: 'save' | 'cancel') => string | null;
  onQueueLoadText?: (text: string) => void;
}

/** 命令式句柄（队列编辑时父级读/写草稿） */
export interface AgentCardComposerHandle {
  getValue: () => string;
  setValue: (text: string) => void;
}

const AgentCardComposer = forwardRef<AgentCardComposerHandle, AgentCardComposerProps>(function AgentCardComposer({
  profileName,
  isStreaming,
  portReady,
  onSend,
  onCommand,
  onAbort,
  onNewSession,
  attachedImages,
  imageUploading,
  onAddImage,
  onRemoveImage,
  queueEditingId,
  onQueueStep,
  onQueueExit,
  onQueueLoadText,
}, ref) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState('');
  const slash = useSlashAutocomplete({ enabled: portReady });

  // ── 语音输入 — P4 解禁：后端 voice.record 已真实接线（VAD + 静音自动停止 + 转录回推） ──
  // 转录文本插入光标处（与 handleAddUrl 同语义）；useVoice 内 ref 持有最新回调，闭包不过期
  const voice = useVoice({
    onTranscript: (text) => {
      const el = inputRef.current;
      if (!el) {
        setValue((v) => v + text);
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + text + value.slice(end);
      setValue(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
      });
    },
  });

  // 命令式句柄（队列编辑时父级读/写草稿）
  // 🔴 稳定化：getValue 读 DOM 值（受控组件 DOM 与 state 同步），避免 deps 含 value 导致每次按键重建句柄
  useImperativeHandle(ref, () => ({
    getValue: () => inputRef.current?.value ?? '',
    setValue: (text: string) => setValue(text),
  }), []);

  // ── 自动撑大：内容变化 → 重置高度再按 scrollHeight 撑（单行起，max 120 滚动） ──
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + 'px';
  }, [value]);

  const resetInput = useCallback(() => {
    setValue('');
    slash.close();
  }, [slash]);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    // 拦截 `/` 开头 → 走命令路径（与单视图 handleSend 同语义；prompt.submit 不解析 slash）
    if (text.startsWith('/')) {
      const cmd = text.replace(/^\//, '').split(/\s/)[0].toLowerCase();
      const args = text.replace(/^\/\S+\s*/, '').trim();
      resetInput();
      // 🔴 对齐单视图 handleSend：/new /reset 走前端重置，不走后端 slash.exec
      if (cmd === 'new' || cmd === 'reset') {
        onNewSession();
        return;
      }
      onCommand(cmd, args);
      return;
    }
    onSend(text);
    resetInput();
  }, [value, onSend, onCommand, onNewSession, resetInput]);

  const handleCommandExec = useCallback(
    (cmdName: string, args = '') => {
      resetInput();
      onCommand(cmdName, args);
    },
    [resetInput, onCommand],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setValue(v);
      slash.syncFromValue(v);
    },
    [slash],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 🔴 队列编辑键盘（对齐 Hermes stepQueuedEdit：↑↓遍历 / Escape 取消 / Enter 保存）
      if (queueEditingId) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const result = onQueueStep?.(e.key === 'ArrowUp' ? -1 : 1);
          if (result) {
            setValue(result.text);
            if (result.done) onQueueLoadText?.(result.text);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const restored = onQueueExit?.('cancel');
          if (restored != null) setValue(restored);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const restored = onQueueExit?.('save');
          if (restored != null) setValue(restored);
          return;
        }
      }

      // `/` 命令补全键盘导航（优先于发送）
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
            const argsPart = value.replace(/^\/\S*\s*/, ' ').trim();
            const completed = `/${cmd.name}` + (argsPart ? ' ' + argsPart : '');
            setValue(completed);
            if (e.key === 'Enter') handleCommandExec(cmd.name, argsPart);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          slash.close();
          return;
        }
      }
      // Enter 发送 / Shift+Enter 换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [slash, value, handleCommandExec, handleSend, queueEditingId, onQueueStep, onQueueExit, onQueueLoadText],
  );

  // ── 文件选择（复用 InputArea 的临时 input 模式） ──
  const handleFileSelect = useCallback(() => {
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
          console.error('[AgentCardComposer] File select failed:', err);
        }
      }
    };
    input.click();
  }, [onAddImage]);

  // ── 图片粘贴/拖拽（对齐 InputArea handlePaste/handleDrop）──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try { await onAddImage(file); } catch (err) { console.error('[AgentCardComposer] Paste image failed:', err); }
        }
        break;
      }
    }
  }, [onAddImage]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    for (const file of imageFiles) {
      try { await onAddImage(file); } catch (err) { console.error('[AgentCardComposer] Drop image failed:', err); }
    }
  }, [onAddImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);

  // ── 链接插入光标处 ──
  const handleAddUrl = useCallback((url: string) => {
    const el = inputRef.current;
    if (!el) {
      setValue((v) => v + url + ' ');
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + url + ' ' + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + url.length + 1;
      el.focus();
    });
  }, [value]);

  const hasText = value.trim().length > 0;

  return (
    <div className="relative shrink-0 px-2.5 pb-2.5">
      {/* `/` 命令补全弹窗 — 共享组件，锚定在输入行上方（卡片内渲染，z-50 盖过消息区） */}
      {slash.showPopup && (
        <SlashCommandPopup
          items={slash.filtered}
          selectedIndex={slash.selectedIndex}
          onHover={slash.setSelectedIndex}
          onPick={(cmd) => {
            const args = value.replace(/^\/\S+\s*/, '') || '';
            handleCommandExec(cmd.name, args);
          }}
        />
      )}

      {/* 图片预览（紧凑行，缩略图 + 删除） */}
      {attachedImages.length > 0 && (
        <div className="flex gap-1.5 flex-wrap items-center mb-1.5">
          {attachedImages.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.preview}
                alt={img.name}
                className="w-9 h-9 object-cover rounded-md border border-border"
                draggable={false}
              />
              <button
                onClick={() => { void onRemoveImage(img.id); }}
                className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-primary-foreground rounded-full text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="移除图片"
              >
                ✕
              </button>
            </div>
          ))}
          {imageUploading > 0 && (
            <span className="inline-block w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}

      {/* 单行 composer：[新建] [textarea] [附件] [语音] [发送] 全部收进输入框内
          表面复用单视图 composer-surface（边框色静止18%/悬停30%/聚焦45% 完全一致） */}
      <div className="composer-surface min-w-0 rounded-lg border flex items-end gap-0.5 px-1 py-1">
        {/* 新建会话 — 输入框内最左侧，清空本 Agent 上下文，下条消息后端自动建新 session */}
        <button
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="新建会话"
          aria-label="新建会话"
          onClick={onNewSession}
        >
          <SquarePen size={14} strokeWidth={1.8} />
        </button>

        {/* 自动撑大 textarea — 单行起、随内容向上撑大（max 120 滚动），按钮始终贴底 */}
        <textarea
          ref={inputRef}
          className="flex-1 min-w-0 resize-none bg-transparent px-1 py-1.5 text-[12px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/30"
          style={{ minHeight: '28px', maxHeight: `${MAX_INPUT_HEIGHT}px`, overflowY: 'auto' }}
          placeholder={`发消息给 ${profileName}… ( / 命令)`}
          rows={1}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        />

        {/* 附件 + 菜单（图片接通后端、链接插入光标） */}
        <AttachMenu onPickImage={handleFileSelect} onAddUrl={handleAddUrl} />

        {/* 语音 — P4 解禁：按钮自身传达状态（录音红 / 转录脉冲），严守单行布局 */}
        <button
          type="button"
          onClick={() => { void voice.toggle(); }}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
            voice.status === 'recording'
              ? 'bg-destructive/15 text-destructive'
              : voice.status === 'transcribing'
                ? 'text-primary animate-pulse'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={voice.status === 'recording' ? '点击停止录音' : voice.status === 'transcribing' ? '转录中…' : '语音输入'}
          aria-label={voice.status === 'recording' ? '停止录音' : '语音输入'}
        >
          <MicIcon size={14} />
        </button>

        {/* 唤醒词耳朵开关 — 对齐 Hermes composer WakeWordButton（录音中暂停） */}
        <WakeWordButton pausedForVoice={voice.status === 'recording'} size={14} />

        {/* 发送/停止 — 高对比圆形主按钮，最右侧（与单视图同一设计语言） */}
        <button
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full p-0 outline-none transition-all duration-150 cursor-pointer',
            'bg-foreground text-background hover:bg-foreground/90 active:scale-90',
            'disabled:cursor-not-allowed disabled:bg-foreground/30 disabled:active:scale-100',
          )}
          title={isStreaming ? '停止生成' : '发送 (Enter)'}
          aria-label={isStreaming ? '停止生成' : '发送'}
          disabled={!isStreaming && !hasText}
          onClick={isStreaming ? onAbort : handleSend}
        >
          {isStreaming ? (
            <span className="block size-2 rounded-[0.15rem] bg-current" />
          ) : (
            <SendIcon size={14} />
          )}
        </button>
      </div>
    </div>
  );
});

export default AgentCardComposer;
