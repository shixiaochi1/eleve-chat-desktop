import { useState, useMemo, memo, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { SmallToolIcon, ExpandIcon, CollapseIcon, CheckIcon, LoadingIcon, ErrorIcon } from './Icons';
import DiffLines, { inlineDiffFromResult } from './DiffLines';
import { cn } from '@/lib/utils';
import { useToolViewMode } from '@/store/tool-view';
import { extractPreviewTargets, previewName, stripPreviewTargets } from '@/lib/preview-targets';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { openPreview } from '@/store/preview';
import { isDesktop } from '@/utils/bridge';

/**
 * product 模式人性化摘要（对齐 Hermes fallback.tsx product 语义：
 * 隐藏原始工具数据，显示易读的工具活动）——从参数里提取最关键的一个值：
 * 命令/路径/查询等。technical 模式不消费，展示完整原始参数/结果。
 */
const PRIMARY_ARG_KEYS = ['command', 'path', 'file_path', 'query', 'pattern', 'goal', 'url', 'prompt'];
const PRODUCT_PREVIEW_CHARS = 600;

// 🔴 对齐 Hermes fallback-model/targets.ts：可预览目标判定
const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value);
const looksLikePath = (value: string): boolean =>
  /^file:\/\//i.test(value) || /^(?:\/|\.{1,2}\/|~\/).+/.test(value);

/** 取 record 中第一个非空字符串字段（对齐 Hermes firstStringField） */
function firstStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** 文件编辑工具（对齐 Hermes FILE_EDIT_TOOL_NAMES） */
const FILE_EDIT_TOOLS = new Set(['edit_file', 'patch', 'write_file']);

/** 从 inline_diff 提取 html 路径（对齐 Hermes stripInlineDiffChrome + htmlPathFromInlineDiff） */
function htmlPathFromInlineDiff(value: string): string {
  if (!value) return '';
  const cleaned = value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^\s*┊\s*review diff\s*\n/i, '')
    .trim();
  for (const match of cleaned.matchAll(/(?:^|\s)(?:[ab]\/)?([^\s]+\.html?)(?=\s|$)/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) return candidate;
  }
  return '';
}

/** 外部浏览器打开（对齐 Hermes PrettyLink openExternal：Tauri shell / window.open fallback） */
async function openExternalLink(url: string) {
  if (isDesktop()) {
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function truncateOneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/** 单个工具调用数据 */
export interface ToolCallItem {
  name?: string;
  callId?: string;
  argsStr?: string;
  /** 三值状态（🔴 Phase 3: error 由 part.isError 驱动，消费于 MessageRow） */
  status?: 'pending' | 'done' | 'error';
  resultStr?: string;
  /** 工具执行耗时（秒）— 渲染于头部行状态图标旁（对齐 CLI "工具完成: X (12.1s)"） */
  duration?: number;
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
  const toolViewMode = useToolViewMode();
  const isTechnical = toolViewMode === 'technical';
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

  // product 模式：从参数提取关键值作为人性化活动行（如 terminal 的命令、read_file 的路径）
  const primaryArg = useMemo(() => {
    if (!parsedArgs || typeof parsedArgs !== 'object') return null;
    const record = parsedArgs as Record<string, unknown>;
    for (const key of PRIMARY_ARG_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return truncateOneLine(value, 80);
    }
    return null;
  }, [parsedArgs]);

  // product 模式：结果摘要（截断预览，隐藏完整原始载荷）
  const productResultPreview = useMemo(() => {
    if (!parsedResult) return null;
    // 🔴 delegate_task 对齐 Hermes「Only the final summary is returned」：
    // 结果摘要取 results[].summary（模型自报，非验证事实），不展示原始 JSON
    if (tool.name === 'delegate_task') {
      const results = Array.isArray(parsedResult.results) ? parsedResult.results : [];
      const summaries = (results as Record<string, unknown>[])
        .map((r) => (typeof r?.summary === 'string' ? r.summary : ''))
        .filter(Boolean);
      if (summaries.length > 0) {
        const text = summaries.join('\n\n');
        return text.length > PRODUCT_PREVIEW_CHARS
          ? text.slice(0, PRODUCT_PREVIEW_CHARS) + '\n…（已截断，切换技术模式查看完整输出）'
          : text;
      }
    }
    const text = typeof parsedResult === 'string'
      ? parsedResult
      : JSON.stringify(parsedResult, null, 2);
    if (!text.trim()) return null;
    // 🔴 #preview/ 链接：product 模式正文剥离（对齐 Hermes stripPreviewTargets），
    // 链接行在下方独立渲染（技术模式保留原始数据不剥离）
    const shown = stripPreviewTargets(text);
    if (!shown.trim()) return null;
    return shown.length > PRODUCT_PREVIEW_CHARS
      ? shown.slice(0, PRODUCT_PREVIEW_CHARS) + '\n…（已截断，切换技术模式查看完整输出）'
      : shown;
  }, [parsedResult, tool.name]);

  // 🔴 #preview/ 链接提取：从完整工具结果提取预览目标（对齐 Hermes extractPreviewTargets）
  const previewTargets = useMemo(() => {
    if (!tool.resultStr) return [];
    return extractPreviewTargets(tool.resultStr);
  }, [tool.resultStr]);

  // 🔴 2026-08-10 结构化预览目标提取（对齐 Hermes toolPreviewTarget）：
  // #preview/ markdown 协议之外的第二来源——从 result/args 的 url/path/target/preview
  // 字段直接提取（browser_navigate / web_extract / web_search 特判）。
  // Hermes 基线如此：浏览器工具访问的页面 URL → 工具行 → 预览；不依赖后端输出协议链接。
  const structuredPreviewTargets = useMemo(() => {
    const targets: string[] = [];
    const seen = new Set<string>();
    const add = (v: unknown) => {
      if (typeof v !== 'string' || !v.trim()) return;
      const t = v.trim();
      if (seen.has(t)) return;
      if (looksLikeUrl(t) || looksLikePath(t)) {
        seen.add(t);
        targets.push(t);
      }
    };
    const argsRec = parsedArgs && typeof parsedArgs === 'object'
      ? (parsedArgs as Record<string, unknown>)
      : null;
    const resRec = parsedResult && typeof parsedResult === 'object'
      ? (parsedResult as Record<string, unknown>)
      : null;
    // 直接字段（对齐 Hermes firstStringField 顺序：result.preview/url/target →
    // args.preview/url/target/path/file/filepath → result.path/file/filepath）
    for (const key of ['preview', 'url', 'target']) add(resRec?.[key]);
    for (const key of ['preview', 'url', 'target', 'path', 'file', 'filepath']) add(argsRec?.[key]);
    for (const key of ['path', 'file', 'filepath']) add(resRec?.[key]);
    // 文件编辑工具：从 inline_diff 提取 html 路径（对齐 Hermes toolPreviewTarget isFileEditTool 分支）
    if (tool.name && FILE_EDIT_TOOLS.has(tool.name)) {
      const diff = firstStringField(resRec ?? {}, ['inline_diff', 'diff']);
      const htmlPath = htmlPathFromInlineDiff(diff);
      if (htmlPath && !seen.has(htmlPath)) {
        seen.add(htmlPath);
        targets.push(htmlPath);
      }
    }
    // 特判工具（对齐 Hermes：browser_navigate/web_extract/web_search 取 args.url / result.url）
    if (tool.name === 'browser_navigate' || tool.name === 'web_extract' || tool.name === 'web_search') {
      const explicit =
        (argsRec && firstStringField(argsRec, ['url', 'search_term', 'query'])) ||
        (resRec && firstStringField(resRec, ['url']));
      if (explicit && looksLikeUrl(explicit) && !seen.has(explicit)) {
        seen.add(explicit);
        targets.push(explicit);
      }
    }
    return targets;
  }, [parsedArgs, parsedResult, tool.name]);

  // 合并去重：协议链接 + 结构化字段
  const allPreviewTargets = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...previewTargets, ...structuredPreviewTargets]) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [previewTargets, structuredPreviewTargets]);

  // 点击预览链接 → 打开预览 tab（openPreview 内部自动切右栏）
  const handlePreviewTarget = useCallback((target: string) => {
    const resolved = normalizeOrLocalPreviewTarget(target);
    if (resolved) openPreview(resolved);
  }, []);

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
          {/* product 模式：工具名后跟关键参数（易读的工具活动） */}
          {!isTechnical && primaryArg && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{primaryArg}</span>
          )}
        </span>
        {/* 🔴 Phase 3: 三值状态图标（error 红色 AlertCircle / done 绿勾 / pending spinner） */}
        <span className={cn('text-xs shrink-0', isError ? 'text-destructive' : isDone ? 'text-success' : 'text-muted-foreground')}>
          {isError ? <ErrorIcon size={12} /> : isDone ? <CheckIcon size={12} /> : <LoadingIcon size={12} className="animate-spin" />}
        </span>
        {/* 工具执行耗时 — 已落定时显示（对齐 CLI "工具完成: X (12.1s)"） */}
        {isSettled && tool.duration !== undefined && tool.duration > 0 && (
          <span className="text-xs text-muted-foreground shrink-0 font-mono">
            {tool.duration.toFixed(1)}s
          </span>
        )}
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? <CollapseIcon size={12} /> : <ExpandIcon size={12} />}
        </span>
      </div>

      {expanded && (
        <div className={`tool-call-content ${animReady ? 'expanded' : ''}`}>
          <div className="mt-2 pt-2 border-t border-border space-y-1">
            {isTechnical ? (
              <>
                {/* technical 模式：完整原始参数/结果（对齐 Hermes rawTechnicalTrace 语义） */}
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
              </>
            ) : (
              <>
                {/* product 模式：隐藏原始数据，只显示关键参数行 + 结果摘要 */}
                {primaryArg ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold">关键参数</span>
                    <span className="ml-1.5 font-mono">{primaryArg}</span>
                  </div>
                ) : isSettled ? (
                  <span className="text-xs text-muted-foreground italic">无参数</span>
                ) : (
                  <span className="text-xs text-muted-foreground italic">执行中...</span>
                )}
                {productResultPreview && !inlineDiff && (
                  <>
                    <div className={cn('text-xs font-semibold mt-2', isError ? 'text-destructive' : 'text-muted-foreground')}>
                      {isError ? '错误' : '结果摘要'}
                    </div>
                    <pre className={cn('text-xs font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap wrap-anywhere', isError ? 'bg-destructive/10' : 'bg-muted/50')}>
                      {productResultPreview}
                    </pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {/* 🔴 预览链接行 — 工具结果/参数里的可预览目标（对齐 Hermes status-stack preview-row +
          toolPreviewTarget 结构化提取；点击打开预览 tab） */}
      {allPreviewTargets.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-border space-y-1">
          {allPreviewTargets.map((target) => (
            <button
              key={target}
              onClick={(e) => {
                e.stopPropagation();
                // 🔴 对齐 Hermes PreviewStatusRow：普通点击 = 系统浏览器打开；
                // Ctrl/⌘+点击 = 应用内预览抽屉
                if (e.metaKey || e.ctrlKey) {
                  handlePreviewTarget(target);
                } else {
                  void openExternalLink(target);
                }
              }}
              className="flex items-center gap-1.5 w-full text-xs text-primary hover:underline text-left"
              title={`${target}（点击浏览器打开，Ctrl/⌘+点击预览）`}
            >
              <ExternalLink size={11} className="shrink-0" />
              <span className="truncate">{previewName(target)}</span>
            </button>
          ))}
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
