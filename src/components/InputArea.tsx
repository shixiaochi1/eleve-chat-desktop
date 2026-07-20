import { useRef, useCallback, useEffect, useState } from 'react';
import { fetchCommands } from '../utils/api';
import CommandMenu from './CommandMenu';
import ModelPill from './ModelPill';
import AttachMenu from './AttachMenu';
import VoiceActivityBar from './VoiceActivityBar';
import ThinkingButton from './ThinkingButton';
import FastModeButton from './FastModeButton';
import ComingSoonButton from './ComingSoonButton';
import WebWindowButton from './WebWindowButton';
import { SendIcon, MicIcon, LoadingIcon, ContextFileIcon } from './Icons';
import { cn } from '@/lib/utils';
import type { AttachedImage } from '@/hooks/useImageAttachments';
import type { GroupedModels } from '@/hooks/useModels';
import { useVoice } from '@/hooks/useVoice';

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
  /** 当前模型名（模型胶囊显示用，来自 App 的 useModels 单例） */
  currentModel?: string;
  /** 分组模型列表（模型胶囊下拉用） */
  modelGrouped?: GroupedModels;
  /** 模型列表加载中 */
  modelLoading?: boolean;
  /** 模型列表加载错误 */
  modelError?: string | null;
  /** 切换模型（调用后端 setModel） */
  onSelectModel?: (modelId: string) => void;
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
  currentModel,
  modelGrouped,
  modelLoading,
  modelError,
  onSelectModel,
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** 输入框是否有内容 — 驱动发送键的置灰态（仅布尔翻转时触发渲染） */
  const [hasText, setHasText] = useState(false);
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
    setHasText(false);
    setShowPopup(false);
    setFilter('');
  }, [onSend]);

  const handleCommandExec = useCallback((cmdName: string, args = '') => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setHasText(false);
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

    // 同步 hasText（仅布尔翻转才 setState，避免每次按键重渲染）
    const nextHasText = el.value.trim().length > 0;
    setHasText(prev => (prev === nextHasText ? prev : nextHasText));

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
      {/* Hermes 式容器表面 — 图片预览/输入区在上，控制行在下 */}
      <div className="composer-surface relative rounded-2xl border">
        {/* `/` 命令补全弹窗 — 锚定在容器表面上方 */}
        {showPopup && filtered.length > 0 && (
          <div
            className="absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
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
            <CommandMenu commands={commands} onCommand={handleCommandExec} />
            {/* 附件 "+" 菜单 — Hermes 式附件入口（图片接通后端、链接纯前端、文件/文件夹待原生对话框） */}
            {onAddImage && <AttachMenu onPickImage={handleFileSelect} onAddUrl={handleAddUrl} />}
            {/* 麦克风 — Hermes 式 DictationButton：录音红色脉冲 / 转录转圈 / 空闲 ghost */}
            <button
              onClick={() => { void voice.toggle(); }}
              className={cn(
                'inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-all duration-150',
                voice.status === 'recording'
                  ? 'animate-[voice-recording-pulse_1.6s_ease-in-out_infinite] bg-destructive/15 text-destructive'
                  : voice.status === 'transcribing'
                    ? 'text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              title={voice.status === 'recording' ? '停止录音' : voice.status === 'transcribing' ? '转录中（点击取消）' : '语音输入'}
              aria-label="语音输入"
            >
              {voice.status === 'recording' ? (
                <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
              ) : voice.status === 'transcribing' ? (
                <LoadingIcon size={15} className="animate-spin" />
              ) : (
                <MicIcon size={15} />
              )}
            </button>
            {/* 模型胶囊 — 模型显示 + 分组下拉切换（Hermes 式 Model Pill） */}
            <ModelPill
              model={currentModel}
              grouped={modelGrouped}
              loading={modelLoading}
              error={modelError}
              onSelect={onSelectModel}
            />
            {/* 思考深度 — 低/中/高，config.set 持久化（对齐 Hermes reasoning_effort） */}
            <ThinkingButton />
            {/* 快速模式 — 开关（对齐 Hermes fastMode，后端配置键待确认） */}
            <FastModeButton />
            {/* 上下文文件 — 占位，待后端支持 */}
            <ComingSoonButton icon={<ContextFileIcon className="shrink-0" />} label="文件" title="上下文文件" />
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
