/**
 * AgentCardComposer — 宫格 per-Agent 输入行（全功能紧凑版）
 *
 * 设计（老大 2026-07-31 定稿）：
 *   [新建会话] [自动撑大输入框] [📎附件] [🎤语音] [发送/停止]
 * - 输入框单行起、随内容向上自动撑大（max 120px，超出滚动）
 * - `/` 命令补全 — 与单视图 InputArea 共用 useSlashAutocomplete + SlashCommandPopup（零重复）
 * - 模型选择不在这里 — 放卡片顶部工具状态栏（ModelPill）
 * - 不要 DeepSeek（宫格场景用不上）
 * - 语音按钮保留但禁用（后端 voice.record 是 TODO stub，与单视图一致防假录音）
 * - 图片附件 per-agent：useImageAttachments 经 getSessionId 绑到本 Agent 的 session
 *
 * 与 InputArea 的关系：共享 slash 补全权威源；布局/场景不同（宫格紧凑、无 @路径），
 * 各自持有键盘编排，不强行合并成单一组件（避免 prop 爆炸）。
 */
import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import AttachMenu from './AttachMenu';
import SlashCommandPopup from './SlashCommandPopup';
import { SendIcon, MicIcon } from './Icons';
import { useSlashAutocomplete } from '@/hooks/useSlashAutocomplete';
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
}

export default function AgentCardComposer({
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
}: AgentCardComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState('');
  const slash = useSlashAutocomplete({ enabled: portReady });

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
      onCommand(cmd, args);
      return;
    }
    onSend(text);
    resetInput();
  }, [value, onSend, onCommand, resetInput]);

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
    [slash, value, handleCommandExec, handleSend],
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

      {/* 输入行：[新建会话] [输入框] [附件] [语音] [发送/停止] */}
      <div className="flex items-end gap-1.5">
        {/* 新建会话 — 清空本 Agent 上下文，下条消息后端自动建新 session */}
        <button
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="新建会话"
          aria-label="新建会话"
          onClick={onNewSession}
        >
          <Plus size={15} strokeWidth={1.8} />
        </button>

        {/* 自动撑大输入框 — 表面复用单视图 composer-surface（边框色静止18%/悬停30%/聚灒45% 完全一致） */}
        <div className="composer-surface flex-1 min-w-0 rounded-lg border">
          <textarea
            ref={inputRef}
            className="w-full resize-none bg-transparent px-2.5 py-1.5 text-[12px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/30"
            style={{ minHeight: '30px', maxHeight: `${MAX_INPUT_HEIGHT}px`, overflowY: 'auto' }}
            placeholder={`发消息给 ${profileName}… ( / 命令)`}
            rows={1}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* 附件 + 菜单（图片接通后端、链接插入光标） */}
        <AttachMenu onPickImage={handleFileSelect} onAddUrl={handleAddUrl} />

        {/* 语音 — 后端 voice.record 是 TODO stub，禁用入口防假录音（与单视图一致） */}
        <button
          disabled
          className="inline-flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40 opacity-50"
          title="语音功能开发中"
          aria-label="语音输入（开发中）"
        >
          <MicIcon size={14} />
        </button>

        {/* 发送/停止 — 高对比圆形主按钮（与单视图同一设计语言） */}
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
}
