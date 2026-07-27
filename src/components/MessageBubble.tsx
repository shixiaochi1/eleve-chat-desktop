import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { renderMarkdown } from '../utils/markdown';
import { resolveMediaText } from '../utils/media';
import { CopyIcon, CheckIcon, RegenerateIcon, BotIcon, Edit3Icon } from './Icons';
import { notifySuccess } from '../utils/notifications';
import { cn } from '@/lib/utils';

interface AgentAttribution {
  model?: string;
  goal?: string;
}

interface MessageBubbleProps {
  type: string;
  content?: string;
  streaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
  agentAttribution?: AgentAttribution;
}

/**
 * 检查文本是否可能包含需要解析的本地图片
 */
function mayHaveLocalImage(text?: string): boolean {
  if (!text) return false;
  if (text.includes('MEDIA:')) return true;
  return /!\[[^\]]*\]\((?!https?:|data:|#|\/\/)[^)]+\)/.test(text);
}

/**
 * 消息气泡 — user / agent / system / error
 *
 * 支持 agentAttribution: 当消息来自委托子 Agent 时，显示模型/目标徽标
 *
 * streaming 模式优化：流式期间跳过 Markdown 渲染（marked + DOMPurify + addCopyButtons），
 * 只做简单换行显示。流式结束后一次性渲染完整 Markdown。
 * 避免每次 content 变化都全量重渲染 → O(n²) DOM 操作 → 内存/CPU 爆炸
 */
export default function MessageBubble({ type, content, streaming, onRegenerate, onEdit, agentAttribution }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [displayContent, setDisplayContent] = useState(content);
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  // 解析本地图片引用（仅非流式时，避免流式期间频繁异步 resolve）
  useEffect(() => {
    if (streaming) {
      setDisplayContent(content ?? "");
      return;
    }
    let cancelled = false;
    if (mayHaveLocalImage(content ?? "")) {
      resolveMediaText(content ?? "").then((resolved) => {
        if (!cancelled) setDisplayContent(resolved);
      });
    } else {
      setDisplayContent(content ?? "");
    }
    return () => { cancelled = true; };
  }, [content, streaming]);

  // 非流式时缓存 Markdown 渲染结果，避免父组件 re-render 导致重复渲染
  const renderedHtml = useMemo(() => {
    if (streaming) return null; // 流式期间不渲染 Markdown
    return renderMarkdown(displayContent || '');
  }, [displayContent, streaming]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest('img');
      if (!img) return;
      e.preventDefault();
      setZoomedSrc(img.src);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [renderedHtml]);

  useEffect(() => {
    if (!zoomedSrc) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if ((e as KeyboardEvent).key === 'Escape' || e.type === 'click') setZoomedSrc(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [zoomedSrc]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [content]);

  if (type === 'system') {
    return (
      <div className="text-xs text-center text-muted-foreground py-1 px-3">
        {content}
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div className="w-fit max-w-[85%] bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
        {content}
      </div>
    );
  }

  if (type === 'user') {
    // 编辑模式
    if (editing) {
      return (
        <div className="bg-user-bubble rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[80%] ml-auto border border-user-bubble-border">
          <textarea
            ref={editRef}
            className="desktop-input-chrome w-full rounded-md border px-3 py-2 text-sm outline-none resize-none min-h-[60px]"
            value={editText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditText(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editText.trim() && editText.trim() !== content) {
                  onEdit?.(editText.trim());
                  notifySuccess('消息已编辑');
                }
                setEditing(false);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
          <div className="flex gap-2 justify-end mt-2">
            <button
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-medium',
                'transition-all outline-none h-7 px-3',
                'hover:bg-accent hover:text-accent-foreground'
              )}
              onClick={() => setEditing(false)}
            >取消</button>
            <button
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-medium',
                'transition-all outline-none h-7 px-3',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:pointer-events-none disabled:opacity-50'
              )}
              disabled={!editText.trim() || editText.trim() === content}
              onClick={() => {
                if (editText.trim() && editText.trim() !== content) {
                  onEdit?.(editText.trim());
                  notifySuccess('消息已编辑');
                }
                setEditing(false);
              }}
            >确认</button>
          </div>
        </div>
      );
    }
    return (
      <div className="bg-user-bubble text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed max-w-[80%] ml-auto relative group select-text border border-user-bubble-border shadow-sm">
        <span className="whitespace-pre-wrap break-words">{content}</span>
        <button
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="编辑消息"
          onClick={() => { setEditText(content || ''); setEditing(true); }}
        >
          <Edit3Icon size={12} />
        </button>
        <button
          className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title={copied ? '已复制' : '复制'}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      </div>
    );
  }

  // ── agent 消息 ──
  // 流式期间：纯文本 + 简单换行（跳过 marked/DOMPurify/addCopyButtons，根治 O(n²) 重渲染）
  // 流式结束：完整 Markdown 渲染（含代码高亮 + 复制按钮）
  if (streaming) {
    // 🔴 w-fit：气泡宽度跟随内容（修复 flex stretch 拉满问题）
    // 流式期间不显示操作栏（内容未定稿），结束后统一渲染
    return (
      <div className="w-fit max-w-[85%] min-w-0 select-text">
        <div className="bg-card text-card-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed border border-border shadow-sm overflow-hidden">
          <span ref={textRef} className="whitespace-pre-wrap break-words">
            {displayContent || ''}
          </span>
        </div>
      </div>
    );
  }

  // 非流式：完整 Markdown 渲染（useMemo 缓存）
  // 🔴 w-fit：气泡宽度跟随内容（修复 flex stretch 拉满问题）
  // 🔴 操作栏移出气泡：hover 显示，气泡最小宽度不再被按钮行撑开
  return (
    <div className="group w-fit max-w-[85%] min-w-0 select-text">
      <div className="bg-card text-card-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed border border-border shadow-sm overflow-hidden">
        {agentAttribution && (
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5"
            title={`来自委托 Agent: ${agentAttribution.model || ''} — ${agentAttribution.goal || ''}`}
          >
            <BotIcon size={10} />
            <span className="font-medium">{agentAttribution.model || '子 Agent'}</span>
            {agentAttribution.goal && (
              <span className="text-muted-foreground/70 truncate">{agentAttribution.goal}</span>
            )}
          </div>
        )}
        <span ref={textRef} className="prose prose-sm max-w-none [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_img]:max-w-full" dangerouslySetInnerHTML={{ __html: renderedHtml || '<em>(无内容)</em>' }} />
        {zoomedSrc && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: 'var(--ui-bg-chrome)', cursor: 'zoom-out' }}
            onClick={() => setZoomedSrc(null)}
          >
            <img
              src={zoomedSrc}
              className="max-w-[95vw] max-h-[95vh] object-contain"
              alt="放大预览"
            />
          </div>
        )}
      </div>
      {/* 操作栏 — 气泡外，hover 显示 */}
      <div className="flex gap-0.5 mt-1 opacity-0 translate-y-[-2px] transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto">
        <button
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs',
            'transition-all outline-none',
            'text-muted-foreground hover:text-foreground hover:bg-accent',
            copied && 'opacity-100 text-success'
          )}
          title={copied ? '已复制' : '复制'}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
        {onRegenerate && (
          <button
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all outline-none"
            title="重新生成"
            onClick={onRegenerate}
          >
            <RegenerateIcon size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
