import { useRef, useCallback, useEffect, useState } from 'react';
import { fetchCommands } from '../utils/api';
import CommandMenu from './CommandMenu';
import { SendIcon, StopIcon } from './Icons';
import { cn } from '@/lib/utils';
import type { AttachedImage } from '@/hooks/useImageAttachments';

interface CommandDef {
  name: string;
  description: string;
  aliases: string[];
}

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
}

/**
 * 输入区 — textarea 自动调整高度 + Enter 发送 + / 命令补全 + 图片附件
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
export default function InputArea({
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
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (portReady) {
      fetchCommands().then(setCommands).catch(() => {});
    }
  }, [portReady, portVersion]);

  const filtered = filter
    ? commands.filter(c =>
        c.name.startsWith(filter) || c.aliases.some(a => a.startsWith(filter))
      )
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value || '';
    if (!text.trim()) return;
    onSend?.(text);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setShowPopup(false);
    setFilter('');
  }, [onSend]);

  const handleCommandExec = useCallback((cmdName: string, args = '') => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setShowPopup(false);
    setFilter('');
    onCommand?.(cmdName, args);
  }, [onCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPopup && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
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
        setShowPopup(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [showPopup, filtered, selectedIndex, handleSend, handleCommandExec]);

  const handleInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';

    const val = el.value;
    if (val.startsWith('/')) {
      const cmdPart = val.replace(/^\//, '').split(/\s/)[0].toLowerCase();
      setFilter(cmdPart);
      setShowPopup(true);
    } else {
      setShowPopup(false);
      setFilter('');
    }
  }, []);

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
  }, [onAddImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (onAddImage && Array.from(e.dataTransfer.types).includes('Files')) {
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
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  return (
    <div className="p-3">
      {/* 图片预览区 — 已附加的图片缩略图 + 删除按钮 */}
      {attachedImages && attachedImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap items-start">
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
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
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
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
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
      {imageUploading && imageUploading > 0 && (
        <div className="mb-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          上传图片中… ({imageUploading})
        </div>
      )}

      <div className="flex items-center gap-2">
        <CommandMenu commands={commands} onCommand={handleCommandExec} />
        <textarea
          ref={inputRef}
          id="input"
          className="desktop-input-chrome flex-1 rounded-md border px-3 py-2 text-sm outline-none resize-none min-h-[36px] max-h-[150px] leading-normal"
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
        {/* 文件选择按钮 — 附加图片 */}
        {onAddImage && (
          <button
            onClick={handleFileSelect}
            className="inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-all outline-none h-9 w-9 bg-secondary text-secondary-foreground hover:bg-secondary/80"
            title="附加图片"
            aria-label="Attach image"
          >
            📎
          </button>
        )}
        <button
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-sm font-medium',
            'transition-all outline-none h-9 w-9',
            isStreaming
              ? 'bg-destructive text-white hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
          id="send-btn"
          title={isStreaming ? '停止生成' : '发送'}
          aria-label={isStreaming ? 'Stop generation' : 'Send message'}
          onClick={isStreaming ? onAbort : handleSend}
        >
          {isStreaming ? <StopIcon size={14} /> : <SendIcon size={18} />}
        </button>
      </div>

      {showPopup && filtered.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 border border-border rounded-lg bg-popover shadow-lg p-1 max-h-60 overflow-y-auto min-w-[200px] z-50"
          ref={popupRef}
        >
          {filtered.map((cmd, i) => (
            <div
              key={cmd.name}
              className={cn(
                'px-3 py-1.5 text-sm cursor-pointer rounded-md flex items-center gap-2',
                i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                const args = inputRef.current?.value.replace(/^\/\S+\s*/, '') || '';
                handleCommandExec(cmd.name, args);
              }}
            >
              <span className="font-mono text-xs font-medium text-primary">/{cmd.name}</span>
              {cmd.aliases.length > 0 && (
                <span className="text-xs text-muted-foreground">({cmd.aliases.join(', ')})</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto truncate">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
