import { useState, useMemo } from 'react';
import { SmallToolIcon, ExpandIcon, CollapseIcon, CheckIcon, LoadingIcon } from './Icons';
import { cn } from '@/lib/utils';

interface ToolCallCardProps {
  name?: string;
  callId?: string;
  argsStr?: string;
  status?: string;
  resultStr?: string;
}

/**
 * 工具调用卡片 — 可展开/折叠查看参数与结果
 */
export default function ToolCallCard({ name, callId, argsStr, status, resultStr }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [animReady, setAnimReady] = useState(false);
  const isDone = status === 'done';

  const parsedArgs = useMemo(() => {
    if (!argsStr) return null;
    try { return JSON.parse(argsStr); } catch { return null; }
  }, [argsStr]);

  const parsedResult = useMemo(() => {
    if (!resultStr) return null;
    try { return JSON.parse(resultStr); } catch { return null; }
  }, [resultStr]);

  const toggle = () => {
    if (!expanded) {
      // Expanding: mount content first, then animate height
      setExpanded(true);
      requestAnimationFrame(() => setAnimReady(true));
    } else {
      // Collapsing: animate out, then unmount
      setAnimReady(false);
      setTimeout(() => setExpanded(false), 250);
    }
  };

  return (
    <div
      className={cn(
        'border border-border rounded-lg p-2 bg-card mb-1.5 cursor-pointer',
        'hover:bg-accent/50 transition-colors',
        expanded && 'ring-1 ring-border'
      )}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse tool details' : 'Expand tool details'}
      data-call-id={callId || ''}
      onClick={toggle}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    >
      <div className="flex items-center gap-1.5 text-sm">
        <span className="inline-flex items-center shrink-0 text-muted-foreground">
          <SmallToolIcon size={14} />
        </span>
        <span
          className="flex-1 truncate text-sm font-medium"
          title={argsStr ? JSON.stringify(parsedArgs ?? argsStr) : undefined}
        >
          {name}
        </span>
        <span className={cn('text-xs shrink-0', isDone ? 'text-green-500' : 'text-muted-foreground')}>
          {isDone ? <CheckIcon size={12} /> : <LoadingIcon size={12} className="animate-spin" />}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? <CollapseIcon size={12} /> : <ExpandIcon size={12} />}
        </span>
      </div>

      {/* 展开内容 — max-height transition */}
      {expanded && (
        <div className={`tool-call-content ${animReady ? 'expanded' : ''}`}>
          <div className="mt-2 pt-2 border-t border-border space-y-1">
            {parsedArgs ? (
              <>
                <div className="text-xs font-semibold text-muted-foreground">参数</div>
                <pre className="text-xs font-mono bg-muted/50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(parsedArgs, null, 2)}
                </pre>
              </>
            ) : isDone ? (
              <span className="text-xs text-muted-foreground italic">无参数</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">参数加载中...</span>
            )}
            {parsedResult && (
              <>
                <div className="text-xs font-semibold text-muted-foreground mt-2">结果</div>
                <pre className="text-xs font-mono bg-muted/50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(parsedResult, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
