import { useState, useMemo, memo } from 'react';
import { SmallToolIcon, ExpandIcon, CollapseIcon, CheckIcon, LoadingIcon } from './Icons';
import DiffLines, { inlineDiffFromResult } from './DiffLines';
import { cn } from '@/lib/utils';

/** 单个工具调用数据 */
export interface ToolCallItem {
  name?: string;
  callId?: string;
  argsStr?: string;
  status?: string;
  resultStr?: string;
}

interface ToolCallGroupProps {
  /** 组内工具调用列表 */
  tools: ToolCallItem[];
}

/** 特殊工具名 — 不参与分组，由专用组件渲染 */
const SPECIAL_TOOL_NAMES = new Set(['todo', 'image_generate', 'clarify']);

/**
 * 判断是否为特殊工具（不参与分组）
 */
export function isSpecialTool(name?: string): boolean {
  return !!name && SPECIAL_TOOL_NAMES.has(name);
}

/**
 * 工具调用分组容器 — 对齐 Eleve ToolGroupSlot
 *
 * - 单工具：直接展示工具名+状态（无组标题）
 * - 多工具：组标题 "工具操作 · N 步" / "浏览器操作 · N 步"，折叠展示
 */
function ToolCallGroup({ tools }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [animReady, setAnimReady] = useState(false);

  // 组状态：all-done / running / error / warning
  const groupStatus = useMemo(() => {
    const doneCount = tools.filter(t => t.status === 'done').length;
    const runningCount = tools.filter(t => t.status !== 'done').length;
    if (runningCount > 0) return 'running';
    if (doneCount === tools.length) return 'all-done';
    return 'error';
  }, [tools]);

  // 组标题：浏览器/web 前缀统一为"浏览器操作"，其他"工具操作"
  const groupTitle = useMemo(() => {
    const allBrowser = tools.every(t =>
      t.name?.startsWith('browser_') || t.name?.startsWith('web_')
    );
    const prefix = allBrowser ? '浏览器操作' : '工具操作';
    return `${prefix} · ${tools.length} 步`;
  }, [tools]);

  const isMulti = tools.length > 1;

  const toggle = () => {
    if (!expanded) {
      setExpanded(true);
      requestAnimationFrame(() => setAnimReady(true));
    } else {
      setAnimReady(false);
      setTimeout(() => setExpanded(false), 250);
    }
  };

  // 单工具 — 直接渲染一个精简卡片
  if (!isMulti) {
    const t = tools[0];
    return <SingleToolEntry key={t.callId} tool={t} />;
  }

  // 多工具 — 分组容器
  return (
    <div
      className={cn(
        'border border-border rounded-lg bg-card mb-1.5 cursor-pointer max-w-fit min-w-[160px]',
        'hover:bg-accent/50 transition-colors',
        expanded && 'ring-1 ring-border max-w-full'
      )}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? '折叠工具组' : '展开工具组'}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    >
      {/* 组标题 */}
      <div className="flex items-center gap-1.5 p-2 text-sm">
        <span className="inline-flex items-center shrink-0 text-muted-foreground">
          <SmallToolIcon size={14} />
        </span>
        <span className="flex-1 truncate text-sm font-medium">{groupTitle}</span>
        {/* 组状态指示 */}
        {groupStatus === 'running' && (
          <LoadingIcon size={12} className="animate-spin text-muted-foreground" />
        )}
        {groupStatus === 'all-done' && (
          <CheckIcon size={12} className="text-green-500" />
        )}
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? <CollapseIcon size={12} /> : <ExpandIcon size={12} />}
        </span>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className={`tool-call-content ${animReady ? 'expanded' : ''}`}>
          <div className="px-2 pb-2 space-y-1 border-t border-border pt-2">
            {tools.map((t, i) => (
              <SingleToolEntry key={t.callId || `g-${i}`} tool={t} index={i} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 单工具条目（分组内或独立使用） */
const SingleToolEntry = memo(function SingleToolEntry({
  tool,
  index,
  compact = false,
}: {
  tool: ToolCallItem;
  index?: number;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [animReady, setAnimReady] = useState(false);
  const isDone = tool.status === 'done';

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
    // 先尝试从 parsedResult 提取
    const fromResult = inlineDiffFromResult(parsedResult);
    if (fromResult) return fromResult;
    // fallback：resultStr 本身可能是 diff 文本（以 @@ 或 --- 开头）
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

  // compact 模式 — 分组内精简行
  if (compact) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <span className="inline-flex items-center shrink-0 text-muted-foreground">
          <SmallToolIcon size={12} />
        </span>
        <span className="flex-1 truncate font-mono text-xs">{tool.name}</span>
        <span className={cn('shrink-0', isDone ? 'text-green-500' : 'text-muted-foreground')}>
          {isDone ? <CheckIcon size={10} /> : <LoadingIcon size={10} className="animate-spin" />}
        </span>

        {/* compact 展开内容 */}
        {expanded && (
          <div className="tool-call-content-inline" onClick={(e) => e.stopPropagation()}>
            <div className="mt-1 p-1.5 bg-muted/50 rounded text-xs space-y-1">
              {parsedArgs && (
                <pre className="font-mono whitespace-pre-wrap break-all">{JSON.stringify(parsedArgs, null, 2)}</pre>
              )}
              {parsedResult && !inlineDiff && (
                <pre className="font-mono whitespace-pre-wrap break-all border-t border-border pt-1">{JSON.stringify(parsedResult, null, 2)}</pre>
              )}
              {inlineDiff && <DiffLines text={inlineDiff} maxHeight="200px" />}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 独立卡片（单工具时使用）
  return (
    <div
      className={cn(
        'border border-border rounded-lg p-2 bg-card mb-1.5 cursor-pointer max-w-fit min-w-[120px]',
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
        <span className="inline-flex items-center shrink-0 text-muted-foreground">
          <SmallToolIcon size={14} />
        </span>
        <span
          className="flex-1 truncate text-sm font-medium"
          title={tool.argsStr ? JSON.stringify(parsedArgs ?? tool.argsStr) : undefined}
        >
          {tool.name}
        </span>
        <span className={cn('text-xs shrink-0', isDone ? 'text-green-500' : 'text-muted-foreground')}>
          {isDone ? <CheckIcon size={12} /> : <LoadingIcon size={12} className="animate-spin" />}
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
            ) : isDone ? (
              <span className="text-xs text-muted-foreground italic">无参数</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">参数加载中...</span>
            )}
            {parsedResult && !inlineDiff && (
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
      {/* 内联 diff — 始终可见（对齐 Eleve：工具卡片底部直接展示 diff） */}
      {inlineDiff && <DiffLines text={inlineDiff} />}
    </div>
  );
});

export default memo(ToolCallGroup);
