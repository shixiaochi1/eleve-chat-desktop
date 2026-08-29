import { useState, useEffect, useMemo, memo, useCallback, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  SmallToolIcon, ExpandIcon, CollapseIcon, DotIcon,
  TerminalIcon, FileIcon, SearchIcon, Edit3Icon, PencilIcon, PlayIcon, GlobeIcon,
  OutlineIcon, ChatIcon, AgentIcon,
} from './Icons';
import {
  toolRowModel, terminalCardModel, searchCardModel, readCardModel,
  specializedRowModel, delegateCardModel, delegateStatusLabel,
  type ToolRowState, type ToolRowVariant,
  type TerminalCardModel, type SearchCardModel, type ReadCardModel,
  type DelegateCardModel,
} from './tool-row-model';
import DiffLines, { inlineDiffFromResult } from './DiffLines';
import { cn } from '@/lib/utils';
import { firstStringField, truncateOneLine, looksLikeUrl, looksLikePath } from '@/lib/text';
import { isFileEditTool } from '@/lib/changed-files';
import { useToolViewMode } from '@/store/tool-view';
import { extractPreviewTargets, previewName, stripPreviewTargets } from '@/lib/preview-targets';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { getCurrentSessionCwd } from '@/lib/session-cwd';
import { recordPreviewArtifact } from '@/store/preview-status';
import { openPreview } from '@/store/preview';
import { isDesktop } from '@/utils/bridge';

/**
 * product 模式结果摘要（隐藏原始工具数据，显示易读的工具活动）；
 * 行摘要/标题的派生统一走 tool-row-model（🔴 对齐 DSH tool-call-model.ts）。
 * technical 模式不消费摘要，展示完整原始参数/结果。
 */
const PRODUCT_PREVIEW_CHARS = 600;

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
 * variant → 行首图标（对齐 DSH ToolRow 按 variant 供给 icon 的 leading 槽位语义）
 */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  bash: <TerminalIcon size={14} />,
  read: <FileIcon size={14} />,
  search: <SearchIcon size={14} />,
  write: <Edit3Icon size={14} />,
  edit: <PencilIcon size={14} />,
  code: <PlayIcon size={14} />,
  web: <GlobeIcon size={14} />,
  browser: <GlobeIcon size={14} />,
  others: <SmallToolIcon size={14} />,
};

/** keyed 专属行 icon 覆盖（渲染域特判，对齐 DSH toolviews 的 IconChecklist/IconQuestion 专属图标） */
const TOOL_OVERRIDE_ICONS: Record<string, ReactNode> = {
  todo: <OutlineIcon size={14} />,
  clarify: <ChatIcon size={14} />,
  delegate_task: <AgentIcon size={14} />,
};

/**
 * 行首状态替换（对齐 DSH ToolRow leadingFor）：
 * error → 红 StateDot（实心点）；running/ok 保留 variant 图标 —
 * running 的进行中信号由行级 sweep 光带（data-state 驱动 CSS）承载，
 * 图标本身不替换（对齐 DSH "Running keeps the icon"）。
 */
function leadingFor(state: ToolRowState, icon: ReactNode): ReactNode {
  if (state === 'error') return <DotIcon className="text-destructive" />;
  if (state === 'stopped') return <DotIcon className="text-warning" />;
  return icon;
}

// ── 展开体卡片渲染（对齐 DSH 卡片原语 TerminalBlock/SearchBlock/ReadBlock 的信息结构，
//    以 ELEVE tailwind token 重绘；小节标签样式对齐 Hermes TOOL_SECTION_LABEL_CLASS）──

const CARD_SECTION_LABEL_CLASS =
  'px-2 pt-1.5 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/70';

function hostnameOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}`;
  } catch {
    return url;
  }
}

/** delegate 任务状态 → 点色（中文标签统一走模型层 delegateStatusLabel 单一权威源） */
function delegateStatusDot(status: string): string {
  switch (status) {
    case 'completed': return 'text-success';
    case 'failed': return 'text-destructive';
    case 'interrupted': return 'text-warning';
    case 'error': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

/** delegate 任务卡：每任务一行卡（状态点 + 摘要/错误 + 时长 + 模型）。
 *  嵌套子调用不进主会话事件流（隔离上下文），DSH subCalls 树无数据源——
 *  任务结果卡承担 delegate 详情，行摘要由 delegateRowModel 承担（对齐后端
 *  DelegateEnd summary 语义）。 */
function DelegateCardBody({ card }: { card: DelegateCardModel }) {
  return (
    <div className="space-y-1">
      {card.tasks.map((task, i) => {
        const dot = delegateStatusDot(task.status);
        return (
          <div key={i} className="rounded-md border border-border/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <DotIcon className={cn('shrink-0', dot)} />
              <span className="font-medium">任务 {task.index + 1}</span>
              <span className={cn(dot, 'text-[10px]')}>{delegateStatusLabel(task.status)}</span>
              {task.durationSeconds !== null && task.durationSeconds > 0 && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {task.durationSeconds.toFixed(1)}s
                </span>
              )}
            </div>
            {(task.summary || task.error) && (
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                {task.error || task.summary}
              </p>
            )}
            {task.model && (
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{task.model}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 终端卡片：$ 命令行 + stdout/stderr 分段（分离流存在时）或合并输出 + 退出码徽标。
 *  stderr 用中性色（对齐 Hermes：很多 CLI 用 stderr 打印进度/提示，不作为破坏性渲染） */
function TerminalCardBody({ card }: { card: TerminalCardModel }) {
  const hasSplitStreams = card.stdout !== undefined || card.stderr !== undefined;
  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      {card.command && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 border-b border-border/60 font-mono text-xs">
          <span className="text-success shrink-0 select-none" aria-hidden>$</span>
          <span className="break-all whitespace-pre-wrap">{card.command}</span>
        </div>
      )}
      {hasSplitStreams ? (
        <>
          {card.stdout !== undefined && (
            <section>
              <div className={CARD_SECTION_LABEL_CLASS}>stdout</div>
              <pre className="px-2 pb-1.5 font-mono text-xs whitespace-pre-wrap break-all">{card.stdout || '(无输出)'}</pre>
            </section>
          )}
          {card.stderr !== undefined && (
            <section>
              <div className={CARD_SECTION_LABEL_CLASS}>stderr</div>
              <pre className="px-2 pb-1.5 font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">{card.stderr || '(无输出)'}</pre>
            </section>
          )}
        </>
      ) : card.output ? (
        <pre className="px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-all">{card.output}</pre>
      ) : null}
      {card.exitCode !== null && (
        <div className="flex items-center px-2 py-1 border-t border-border/60 text-[10px] font-mono">
          <span className={card.exitCode === 0 ? 'text-success' : 'text-destructive'}>
            {card.exitCode === 0 ? '✓ 退出码 0' : `✗ 退出码 ${card.exitCode}`}
          </span>
        </div>
      )}
    </div>
  );
}

/** 搜索卡片：原始查询行 + 结构化命中列表（标题可点开外链，对齐 Hermes searchHits） */
function SearchCardBody({ card, onOpenUrl }: { card: SearchCardModel; onOpenUrl: (url: string) => void }) {
  return (
    <div className="space-y-1.5">
      {card.query && (
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold">查询</span>
          <span className="ml-1.5">{card.query}</span>
        </div>
      )}
      <div className="space-y-1">
        {card.hits.map((hit, i) => (
          <div
            key={`${hit.url || hit.title}-${i}`}
            className="rounded-md border border-border/60 px-2 py-1.5 hover:bg-accent/40 transition-colors"
          >
            {hit.url ? (
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline text-left"
                onClick={() => onOpenUrl(hit.url)}
              >
                {hit.title || hit.url}
              </button>
            ) : (
              <span className="text-xs font-medium">{hit.title}</span>
            )}
            {hit.url && (
              <div className="text-[10px] text-muted-foreground/70 truncate font-mono">{hostnameOf(hit.url)}</div>
            )}
            {hit.snippet && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{hit.snippet}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 读取卡片：路径标签 + 行号 gutter 内容块（对齐 DSH ReadBlock 信息结构：
 *  label 相对化路径 / lines 行号文本 / totalLines 总行数；后端已带行号时跳过 gutter） */
function ReadCardBody({ card }: { card: ReadCardModel }) {
  const MAX_RENDER_LINES = 200;
  const shown = card.lines.slice(0, MAX_RENDER_LINES);
  const hidden = card.lines.length - shown.length;
  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-border/60 text-[10px] text-muted-foreground">
        <span className="font-mono truncate">{card.label}</span>
        {card.totalLines !== null && (
          <span className="shrink-0 ml-2">{card.truncated ? `共 ${card.totalLines} 行（已截断）` : `共 ${card.totalLines} 行`}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <pre className="px-2 py-1.5 font-mono text-xs leading-relaxed">
          {shown.map((line, i) => (
            <div key={i} className="flex">
              {line.number > 0 && (
                <span className="w-10 shrink-0 select-none text-right pr-2 text-muted-foreground/50">{line.number}</span>
              )}
              <span className="whitespace-pre-wrap break-all">{line.text}</span>
            </div>
          ))}
        </pre>
      </div>
      {(hidden > 0 || card.truncated || (card.totalLines !== null && card.lines.length < card.totalLines)) && (
        <div className="px-2 py-1 border-t border-border/60 text-[10px] text-muted-foreground">
          {hidden > 0 && <span>其余 {hidden} 行未渲染 — 切换技术模式查看完整输出</span>}
          {card.truncated && card.totalLines !== null && (
            <span>文件已截断 — 可用 offset 参数继续读取</span>
          )}
          {!card.truncated && hidden === 0 && card.totalLines !== null && card.lines.length < card.totalLines && (
            <span>本次读取 {card.lines.length} 行（共 {card.totalLines} 行）— 可用 offset 参数继续读取</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 工具调用全宽单行 — 对齐 DSH ui-tool ToolRow（24px 折叠单行 + 展开体）：
 *   [16px leading: variant 图标 / 错误态 StateDot] [标题] [2×2 分隔点] [摘要 FILL truncate] [耗时] [chevron]
 *
 * - 无边框全宽行，不再是 max-w-fit 小卡片（老大拍板 2026-08-29）；
 * - 标题/摘要由 tool-row-model 派生（variant 分类 + 中文标题 + 摘要键表 + cwd 相对化）；
 * - 错误行折叠摘要 = 失败第一行（错误色，对齐 DSH）；
 * - 折叠态永远单行；展开体为头行兄弟节点，内部点击不触发行折叠（对齐 DSH bodyWrap）。
 */
const ToolEntry = memo(function ToolEntry({ tool, sessionId }: { tool: ToolCallItem; sessionId?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [animReady, setAnimReady] = useState(false);
  const toolViewMode = useToolViewMode();
  const isTechnical = toolViewMode === 'technical';

  const parsedArgs = useMemo(() => {
    if (!tool.argsStr) return null;
    try { return JSON.parse(tool.argsStr); } catch { return null; }
  }, [tool.argsStr]);

  const parsedResult = useMemo(() => {
    if (!tool.resultStr) return null;
    try { return JSON.parse(tool.resultStr); } catch { return null; }
  }, [tool.resultStr]);

  // 🔴 行模型一次派生（对齐 DSH toolRowModel：variant/标题/摘要/错误行/状态）
  const row = useMemo(
    () => toolRowModel(tool.name ?? '', parsedArgs ?? tool.argsStr, tool.resultStr, parsedResult, tool.status, getCurrentSessionCwd() || undefined),
    [tool.name, tool.argsStr, tool.resultStr, tool.status, parsedResult],
  );
  const isError = row.state === 'error';
  const isDone = row.state === 'ok';
  const isSettled = isDone || isError;

  // 错误行折叠摘要 = 失败第一行（对齐 DSH：failureLine 整体替换 args 摘要）
  const failureLine = row.errorSummary;

  // ── keyed 专属行视图（对齐 DSH toolviews：todo/clarify/delegate 命中替换标题/摘要，
  //    错误行走通用失败语义——专属模型在非 ok 态自行返回 null）──
  const specialized = useMemo(
    () => specializedRowModel(tool.name ?? '', parsedArgs ?? tool.argsStr, parsedResult, row.state),
    [tool.name, tool.argsStr, parsedArgs, parsedResult, row.state],
  );
  const summaryText = failureLine
    ?? (specialized ? truncateOneLine(specialized.summary, 160) : truncateOneLine(row.summary, 160));
  const summarySuffix = failureLine === null ? specialized?.summarySuffix ?? null : null;
  const rowTitle = specialized?.title ?? row.title;

  // ── 展开体卡片派生（🔴 对齐 DSH："a call carries at most one card kind"，
  //    互斥；running 无 result 时均 null → 走通用参数/结果体）──
  const delegateCard = useMemo(
    () => delegateCardModel(parsedResult),
    [parsedResult],
  );
  const terminalCard = useMemo(
    () => (tool.name ? terminalCardModel(tool.name, parsedArgs ?? tool.argsStr, parsedResult) : null),
    [tool.name, tool.argsStr, parsedArgs, parsedResult],
  );
  const searchCard = useMemo(
    () => (tool.name ? searchCardModel(tool.name, parsedArgs ?? tool.argsStr, parsedResult) : null),
    [tool.name, tool.argsStr, parsedArgs, parsedResult],
  );
  const readCard = useMemo(
    () => (tool.name ? readCardModel(tool.name, parsedArgs ?? tool.argsStr, parsedResult, getCurrentSessionCwd() || undefined) : null),
    [tool.name, tool.argsStr, parsedArgs, parsedResult],
  );

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
    if (tool.name && isFileEditTool(tool.name)) {
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

  // 🔴 2026-08-28 对齐 Hermes tool/fallback.tsx:411：工具行检测到的可预览目标
  // 上报 composer 状态行 feed（recordPreviewArtifact 幂等，每次渲染重报不 churn）
  useEffect(() => {
    if (!sessionId) return;
    for (const t of [...previewTargets, ...structuredPreviewTargets]) {
      recordPreviewArtifact(sessionId, t, getCurrentSessionCwd() || '');
    }
  });

  // 点击预览链接 → 打开预览 tab（openPreview 内部自动切右栏）
  const handlePreviewTarget = useCallback((target: string) => {
    const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd());
    if (resolved) openPreview(resolved, 'explicit-link');
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
      className="tool-row flex flex-col min-w-0"
      data-call-id={tool.callId || ''}
      data-variant={row.variant}
      data-tool={tool.name || ''}
      data-state={row.state}
    >
      {/* ── 折叠单行（对齐 DSH ToolRow 24px line）：全宽、无边框、整行可点 ── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? '折叠工具详情' : '展开工具详情'}
        className="tool-row-line relative flex items-center gap-2 h-6 min-w-0 w-full cursor-pointer rounded-md px-1.5 -mx-1.5 hover:bg-accent/40 transition-colors"
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <span className={cn('inline-flex items-center justify-center size-4 shrink-0', isError ? 'text-destructive' : 'text-muted-foreground')}>
          {leadingFor(row.state, TOOL_OVERRIDE_ICONS[tool.name ?? ''] ?? VARIANT_ICONS[row.variant])}
        </span>
        <span
          className={cn(
            'shrink-0 max-w-[50%] truncate font-medium text-sm',
            isTechnical && 'font-mono text-xs',
            isError ? 'text-destructive' : 'text-foreground',
          )}
          title={tool.argsStr ? JSON.stringify(parsedArgs ?? tool.argsStr) : undefined}
        >
          {isTechnical ? (tool.name ?? 'tool') : rowTitle}
        </span>
        {/* 空摘要时分隔点一起消失（对齐 DSH："a row that is only its title shows no trailing dot"） */}
        {summaryText !== '' && (
          <>
            <span aria-hidden className="shrink-0 size-0.5 rounded-full bg-muted-foreground/40" />
            <span
              className={cn(
                'flex-1 min-w-0 truncate text-xs',
                failureLine !== null ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {summaryText}
            </span>
          </>
        )}
        {/* 摘要外尾注（对齐 DSH summarySuffix：不参与截断的关键计数，如并行活动任务数） */}
        {summarySuffix !== null && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{summarySuffix}</span>
        )}
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

      {/* ── 展开体（头行兄弟节点：内部点击不触发行折叠，对齐 DSH bodyWrap）──
          卡片（对齐 DSH "a call carries at most one card kind"：互斥派生）+
          technical 附加原始参数/结果 JSON（🔴 默认模式是 technical，卡片命中时
          也必须保留原始数据视图——对齐 Hermes ToolPayloadDisclosure 语义）；
          product 无卡片命中走通用关键参数/结果摘要 */}
      {expanded && (
        <div className={`tool-call-content ${animReady ? 'expanded' : ''}`}>
          <div className="mt-2 pt-2 border-t border-border max-h-64 overflow-y-auto space-y-1">
            {delegateCard && <DelegateCardBody card={delegateCard} />}
            {terminalCard && <TerminalCardBody card={terminalCard} />}
            {searchCard && <SearchCardBody card={searchCard} onOpenUrl={(url) => void openExternalLink(url)} />}
            {readCard && <ReadCardBody card={readCard} />}
            {isTechnical && (
              <>
                {/* technical 模式：完整原始参数/结果（对齐 Hermes rawTechnicalTrace 语义） */}
                {parsedArgs ? (
                  <>
                    <div className={cn('text-xs font-semibold text-muted-foreground', (delegateCard || terminalCard || searchCard || readCard) && 'mt-2')}>
                      参数
                    </div>
                    <pre className="text-xs font-mono bg-muted/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(parsedArgs, null, 2)}
                    </pre>
                  </>
                ) : !delegateCard && !terminalCard && !searchCard && !readCard ? (
                  isSettled ? (
                    <span className="text-xs text-muted-foreground italic">无参数</span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">参数加载中...</span>
                  )
                ) : null}
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
            )}
            {!isTechnical && !delegateCard && !terminalCard && !searchCard && !readCard && (
              <>
                {/* product 模式：隐藏原始数据，只显示关键参数行 + 结果摘要 */}
                {row.summary ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold">关键参数</span>
                    <span className="ml-1.5 font-mono">{truncateOneLine(row.summary, 120)}</span>
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
      {/* 内联 diff — 始终可见（对齐 Eleve：工具行底部直接展示 diff） */}
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
