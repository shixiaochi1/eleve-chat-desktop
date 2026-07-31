import { useState, useMemo, memo } from 'react';
import { SmallToolIcon, ExpandIcon, CollapseIcon, CheckIcon, LoadingIcon, ErrorIcon } from './Icons';
import DiffLines, { inlineDiffFromResult } from './DiffLines';
import { cn } from '@/lib/utils';

/** 单个工具调用数据 */
export interface ToolCallItem {
  name?: string;
  callId?: string;
  argsStr?: string;
  /** 三值状态（🔴 Phase 3: error 由 part.isError 驱动，消费于 MessageRow） */
  status?: 'pending' | 'done' | 'error';
  resultStr?: string;
}

/**
 * 工具调用独立行 — 对齐 Hermes「工具永不分组」（fallback.tsx ToolGroupSlot）
 *
 * Hermes 实证：连续 tool-call 的 range 切片不稳定（流式碎片 vs 落定整段），
 * 按 range 分组会在落定瞬间重排整轮。故每个工具独立成行 + 稳定 identity（callId key），
 * 碎片或整段像素级一致，无重排。
 *
 * 状态机（对齐 Hermes toolStatus）：
 *   pending = 执行中（spinner）/ done = 成功（绿勾）/ error = 失败（红色 AlertCircle）
 */
const ToolEntry = memo(function ToolEntry({ tool }: { tool: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const [animReady, setAnimReady] = useState(false);
  const isError = tool.status === 'error';
  const isDone = tool.status === 'done';
  const isSettled = isDone || isError;

  const parsedArgs = useMemo(() => {
    if (!tool.argsStr) return null;
    try { return JSON.parse(tool.argsStr); } catch { return null; }
  }, [tool.argsStr]);

  const parsedResult = useMemo(() => {
    if (!tool.resultStr) return null;
    try { return JSON.parse(tool.resultStr); } catch { return null; }
  }, [tool.resultStr]);

  // 提取 inline_diff（对齐 Eleve：优先从 result.inline_diff 字段获取）
  const inlineDiff = useMemo(() => {
    const fromResult = inlineDiffFromResult(parsedResult);
    if (fromResult) return fromResult;
    // fallback：resultStr 本身可能是 diff 文本（以 --- 开头）
    if (tool.resultStr && tool.resultStr.trim().startsWith('---')) {
      return tool.resultStr.trim();
    }
    return null;
  }, [parsedResult, tool.resultStr]);

  const toggle = () => {
    if (!expanded) {
      setExpanded(true);
      requestAnimationFrame(() => setAnimReady(true));
    } else {
      setAnimReady(false);
      setTimeout(() => setExpanded(false), 250);
    }
  };

  return (
    <div
      className={cn(
        'border rounded-lg p-2 bg-card mb-1.5 cursor-pointer max-w-fit min-w-[120px]',
        isError ? 'border-destructive/40' : 'border-border',
        'hover:bg-accent/50 transition-colors',
        expanded && 'ring-1 ring-border max-w-full'
      )}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? '折叠工具详情' : '展开工具详情'}
      data-call-id={tool.callId || ''}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    >
      <div className="flex items-center gap-1.5 text-sm">
        <span className={cn('inline-flex items-center shrink-0', isError ? 'text-destructive' : 'text-muted-foreground')}>
          <SmallToolIcon size={14} />
        </span>
        <span
          className="flex-1 truncate text-sm font-medium"
          title={tool.argsStr ? JSON.stringify(parsedArgs ?? tool.argsStr) : undefined}
        >
          {tool.name}
        </span>
        {/* 🔴 Phase 3: 三值状态图标（error 红色 AlertCircle / done 绿勾 / pending spinner） */}
        <span className={cn('text-xs shrink-0', isError ? 'text-destructive' : isDone ? 'text-success' : 'text-muted-foreground')}>
          {isError ? <ErrorIcon size={12} /> : isDone ? <CheckIcon size={12} /> : <LoadingIcon size={12} className="animate-spin" />}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? <CollapseIcon size={12} /> : <ExpandIcon size={12} />}
        </span>
      </div>

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
            ) : isSettled ? (
              <span className="text-xs text-muted-foreground italic">无参数</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">参数加载中...</span>
            )}
            {parsedResult && !inlineDiff && (
              <>
                <div className={cn('text-xs font-semibold mt-2', isError ? 'text-destructive' : 'text-muted-foreground')}>
                  {isError ? '错误' : '结果'}
                </div>
                <pre className={cn('text-xs font-mono p-2 rounded overflow-x-auto', isError ? 'bg-destructive/10' : 'bg-muted/50')}>
                  {JSON.stringify(parsedResult, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
      {/* 内联 diff — 始终可见（对齐 Eleve：工具卡片底部直接展示 diff） */}
      {inlineDiff && <DiffLines text={inlineDiff} />}
      {/* skill_view setup_needed 提示横幅（对标 Hermes: readiness_status != "ready"） */}
      {tool.name === 'skill_view' && parsedResult?.setup_needed && (
        <div className="mt-1.5 px-2 py-1.5 rounded bg-warning/10 border border-warning/30 text-xs">
          <div className="font-semibold text-warning">⚠ Setup Required</div>
          {Array.isArray(parsedResult.missing_required_environment_variables) && (
            <div className="mt-1 text-muted-foreground">
              Missing: {parsedResult.missing_required_environment_variables.map((e: any) => e?.name).filter(Boolean).join(', ')}
            </div>
          )}
          {parsedResult.gateway_setup_hint && (
            <div className="mt-0.5 text-muted-foreground">{parsedResult.gateway_setup_hint as string}</div>
          )}
        </div>
      )}
    </div>
  );
});

export default ToolEntry;
