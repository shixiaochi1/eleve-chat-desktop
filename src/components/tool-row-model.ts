/**
 * tool-row-model — 工具行纯函数模型（🔴 对齐 DSH ui-tool tool-call-model.ts：
 * "Pure row-model derivation for tool summary rows"，数据派生与渲染分离）。
 *
 * - variant / title / summary 从 call ARGUMENTS 派生；
 * - 错误行摘要从 result 派生（对齐 DSH："an error row's collapsed summary is
 *   the failure's first line in the error color"）；
 * - 渲染消费方（ToolEntry）只接收本模型产出，不重复派生逻辑。
 *
 * 架构对齐 DSH；标题文案为 ELEVE 中文 UI 对应（DSH 为 Figma 英文字面量）。
 *
 * 文本工具（firstRawStringField/truncateOneLine）复用 @/lib/text——严禁重复造轮子。
 */

import { firstRawStringField, truncateOneLine } from '@/lib/text';

/** 行 variant 分类（对齐 DSH ToolRowVariant + ELEVE 工具集扩展 web/browser） */
export type ToolRowVariant =
  | 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'web' | 'browser' | 'others';

/**
 * 行状态语义（对齐 DSH ToolRowState 四态）。
 * stopped（琥珀）预留：ELEVE 后端暂无独立 interrupted 信号（中断落 isError），
 * 信号源接入后在 deriveState 分流，不回退已接入 UI 的语义。
 */
export type ToolRowState = 'running' | 'ok' | 'error' | 'stopped';

/** variant 标题（对齐 DSH VARIANT_TITLES；中文对应文案） */
export const VARIANT_TITLES: Record<ToolRowVariant, string> = {
  search: '搜索', read: '读取', bash: '执行',
  write: '写入', edit: '编辑', code: '代码',
  web: '网页', browser: '浏览器', others: '工具调用',
};

/** 工具名 → variant（对齐 DSH TOOL_VARIANTS + ELEVE 工具集扩展；以 ELEVE 真实注册名为准） */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  // 执行族（bash row family：icon 同 terminal）
  terminal: 'bash',
  execute_code: 'bash',
  // computer_use 是动作回执（截图/点击，无 output/exit_code）——DSH 哲学：
  // "produce a receipt → generic row is the decided intent"，归 others 走通用行。
  // 读取族
  read_file: 'read',
  list_files: 'read',
  skill_view: 'read',
  // 搜索族（ELEVE 注册名：session_search；无 web_fetch 工具——网页抓取是 web_extract）
  web_search: 'search',
  x_search: 'search',
  search_files: 'search',
  session_search: 'search',
  // 写入/编辑族
  write_file: 'write',
  edit_file: 'edit',
  patch: 'edit',
  // 代码族
  run_code: 'code',
  // 网页/浏览器族
  web_extract: 'web',
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_fill: 'browser',
  browser_type: 'browser',
  browser_snapshot: 'browser',
  browser_take_screenshot: 'browser',
};

/** 工具专属标题（对齐 DSH TOOL_TITLES：精化 generic variant 而不替换行机制） */
const TOOL_TITLES: Record<string, string> = {
  delegate_task: '委派',
  memory: '记忆',
  todo: '任务规划',
  clarify: '澄清提问',
  image_generate: '图像生成',
  image_gen: '图像生成',
  video_gen: '视频生成',
  tts: '语音合成',
  vision_analyze: '视觉分析',
  cronjob: '定时任务',
  messaging: '消息发送',
  // PowerShell 孪生工具（对齐 DSH：bash row family + 专属标题）
  pwsh: 'Pwsh',
};

/** 摘要键按 variant 优先级（对齐 DSH SUMMARY_KEYS；others 走 fallback 遍历） */
const SUMMARY_KEYS: Record<ToolRowVariant, readonly string[]> = {
  bash: ['description', 'command', 'code'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'search_term', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  web: ['url'],
  browser: ['url', 'target'],
  others: [],
};

/** 路径键专属 — 绝不含 url（对齐 DSH FILE_PATH_KEYS） */
const FILE_PATH_KEYS = ['path', 'file_path'] as const;

/** 摘要可渲染为文件路径链接的 variant（对齐 DSH FILE_PATH_VARIANTS） */
const FILE_PATH_VARIANTS: ReadonlySet<ToolRowVariant> = new Set(['read', 'write', 'edit']);

/** 行模型完整产出 — ToolEntry 渲染的唯一数据源 */
export interface ToolRowModel {
  variant: ToolRowVariant;
  /** product 行标题：工具专属标题 → variant 标题 */
  title: string;
  /** args 派生单行摘要（路径已相对化 cwd） */
  summary: string;
  /** 错误第一行（错误行折叠摘要的替换内容）；非错误为 null */
  errorSummary: string | null;
  /** args 中的文件路径（read/write/edit）；fileLink 渲染预留 */
  filePath: string | undefined;
  state: ToolRowState;
}

/** ELEVE 工具调用三值状态（ToolCallItem.status）→ DSH 四态行状态 */
export function deriveState(status: 'pending' | 'done' | 'error' | undefined): ToolRowState {
  if (status === 'error') return 'error';
  if (status === 'done') return 'ok';
  return 'running';
}

export function classifyTool(toolName: string): ToolRowVariant {
  return TOOL_VARIANTS[toolName] ?? 'others';
}

/** 工具专属标题 → variant 标题（对齐 DSH：TOOL_TITLES 覆盖，VARIANT_TITLES 兜底） */
export function toolTitle(variant: ToolRowVariant, toolName: string): string {
  return TOOL_TITLES[toolName] ?? VARIANT_TITLES[variant];
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

function parseArgs(args: unknown): Record<string, unknown> | undefined {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === 'string' && args.trim()) {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined; // 流式截断的半截 JSON：summary 回退原始串
    }
  }
  return undefined;
}

/** args → 单行摘要：variant 键表优先，fallback 遍历任意字符串字段（对齐 DSH deriveSummary） */
export function deriveSummary(variant: ToolRowVariant, args: unknown): string {
  const parsed = parseArgs(args);
  if (!parsed) {
    return typeof args === 'string' ? firstLine(args) : '';
  }
  const picked = pickString(parsed, SUMMARY_KEYS[variant]);
  if (picked !== undefined) return firstLine(picked);
  for (const v of Object.values(parsed)) {
    if (typeof v === 'string' && v !== '') return firstLine(v);
  }
  return '';
}

/** 工作区根剥离（对齐 DSH relativizeToCwd：绝对路径显示为相对路径） */
export function relativizeToCwd(text: string, cwd: string | undefined): string {
  if (!cwd) return text;
  const root = cwd.replace(/[/\\]+$/, '');
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) {
    return text.slice(root.length + 1);
  }
  return text;
}

/** result → 错误第一行（对齐 DSH：`name: code` 结构化错误优先于正文；先取首行再压平——
 *  顺序反了"首行"就永远失效） */
export function deriveErrorSummary(resultStr: string | undefined, parsedResult: unknown): string | null {
  const rec = parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)
    ? (parsedResult as Record<string, unknown>)
    : null;
  const structured = rec && typeof rec.error === 'string' ? rec.error : '';
  const raw = structured || (typeof parsedResult === 'string' ? parsedResult : resultStr || '');
  const line = firstLine(raw).replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, 200) : null;
}

/** 派生完整行模型（对齐 DSH toolRowModel：一次派生，行渲染全消费） */
export function toolRowModel(
  toolName: string,
  args: unknown,
  resultStr: string | undefined,
  parsedResult: unknown,
  status: 'pending' | 'done' | 'error' | undefined,
  cwd: string | undefined,
): ToolRowModel {
  const variant = classifyTool(toolName);
  const state = deriveState(status);
  const rawSummary = deriveSummary(variant, args);
  const summary = rawSummary ? relativizeToCwd(rawSummary, cwd) : rawSummary;
  // args 解析失败的兜底：DSH 用 callId 站位，ELEVE 无稳定短 id 消费场景，空摘要即可
  // （分隔点随空摘要一起消失，对齐 DSH "a row that is only its title shows no trailing dot"）。
  const filePathParsed = parseArgs(args);
  const filePathRaw = FILE_PATH_VARIANTS.has(variant) && filePathParsed
    ? pickString(filePathParsed, FILE_PATH_KEYS)
    : undefined;
  const filePath = filePathRaw ? relativizeToCwd(filePathRaw, cwd) : undefined;
  return {
    variant,
    title: toolTitle(variant, toolName),
    summary,
    errorSummary: state === 'error' ? deriveErrorSummary(resultStr, parsedResult) : null,
    filePath,
    state,
  };
}

// ── 展开体卡片模型（🔴 对齐 DSH card-model 模式：每卡片一个纯派生函数，
//    "a call carries at most one card kind"；running 无 result → 返回 null 走通用体）──

/** 展开体内联载荷渲染上限（对齐 Hermes MAX_TOOL_RENDER_CHARS：结果服务端封顶 ~100KB，
 *  一轮大量工具行全量绘制会淹没渲染器；Copy/技术模式仍可看全量） */
export const MAX_CARD_RENDER_CHARS = 20_000;

/** clamp 内联绘制载荷（对齐 Hermes clampForDisplay） */
export function clampForDisplay(value: string, max = MAX_CARD_RENDER_CHARS): string {
  if (value.length <= max) return value;
  const omitted = value.length - max;
  return `${value.slice(0, max)}\n\n… ${omitted.toLocaleString()} 字符已截断 — 切换技术模式查看完整输出`;
}

/** 单行首个非空字符串字段（保真版 firstRawStringField 的可空包装，卡片模型内部用） */
function cardField(rec: Record<string, unknown> | null | undefined, keys: readonly string[]): string {
  return rec ? firstRawStringField(rec, keys) : '';
}

/**
 * 终端卡片模型（对齐 DSH terminal-card-model + Hermes hasSplitStreams 语义）。
 * - 合并输出序：stdout+stderr 分离字段存在时分段，否则 `output`，
 *   再兜底 `output_preview`（后台进程轮询，对齐 Hermes）；
 * - exit_code 仅 terminal 落定报告；null = 未知（后台进程未退出）。
 */
export interface TerminalCardModel {
  command: string;
  /** 合并输出（无分离流时的正文） */
  output: string;
  /** 后端分离报告的 stdout / stderr（execute_code 等仅在后端真分字段时非 undefined） */
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
}

export function terminalCardModel(
  toolName: string,
  args: unknown,
  parsedResult: unknown,
): TerminalCardModel | null {
  // 仅终端/代码执行（computer_use 是动作回执，无 output/exit_code，不在此列）
  if (toolName !== 'terminal' && toolName !== 'execute_code') return null;
  const res = parseArgs(parsedResult);
  if (!res) return null; // running / 非对象结果 → 通用体
  const argsRec = parseArgs(args);
  const stdout = cardField(res, ['stdout']);
  const stderr = cardField(res, ['stderr']);
  // 合并输出序：output → output_preview（后台进程轮询兜底，对齐 Hermes）
  const merged = cardField(res, ['output', 'output_preview']);
  // 🔴 ELEVE 数据形状适配：execute_code 结果 = output（stdout 截断版主体）+ stderr
  // 分离流并存；terminal 仅 output 合并流 + exit_code。分段门控以 stderr 非空为准：
  // 分段时 output 归入 stdout 段（execute_code 无 stdout 字段），避免主体输出被丢。
  const hasSplitStreams = Boolean(stderr);
  const exitRaw = res.exit_code;
  return {
    command: cardField(argsRec, ['command', 'code']),
    output: hasSplitStreams ? '' : clampForDisplay(merged),
    stdout: hasSplitStreams ? clampForDisplay(stdout || merged) : undefined,
    // 空串必须归一为 undefined——渲染层以 `!== undefined` 判定分段，空串会造成假分段
    stderr: hasSplitStreams ? stderr : undefined,
    exitCode: typeof exitRaw === 'number' && Number.isFinite(exitRaw) ? exitRaw : null,
  };
}

/** 搜索命中行（对齐 Hermes SearchResultRow） */
export interface SearchHitRow {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索卡片模型（对齐 Hermes extractSearchResults：web_search 结构化结果列表） */
export interface SearchCardModel {
  query: string;
  hits: SearchHitRow[];
}

/** 搜索族工具锁（results 数组形 + 工具名双门控——delegate_task 等结果同为
 *  {results:[...]} 形状，不锁名会误入搜索卡分发） */
const SEARCH_CARD_TOOLS: ReadonlySet<string> = new Set([
  'web_search', 'x_search', 'session_search', 'search_files',
]);

/** 搜索卡片模型（对齐 Hermes extractSearchResults：结构化结果列表） */
export function searchCardModel(
  toolName: string,
  args: unknown,
  parsedResult: unknown,
): SearchCardModel | null {
  if (!SEARCH_CARD_TOOLS.has(toolName)) return null;
  const res = parseArgs(parsedResult);
  const list = res && Array.isArray(res.results) ? res.results : null;
  if (!list || list.length === 0) return null;
  const argsRec = parseArgs(args);
  const hits: SearchHitRow[] = [];
  for (const item of list) {
    const rec = parseArgs(item);
    if (!rec) continue;
    const title = (cardField(rec, ['title', 'name']) || '').replace(/\s+/g, ' ').trim();
    const url = cardField(rec, ['url', 'href', 'link']);
    const snippet = (cardField(rec, ['snippet', 'description', 'body', 'text']) || '')
      .replace(/\s+/g, ' ').trim();
    if (title || url) hits.push({ title, url, snippet });
    if (hits.length >= 6) break; // 对齐 Hermes limit=6
  }
  if (hits.length === 0) return null;
  return {
    query: cardField(argsRec, ['search_term', 'query', 'pattern']),
    hits,
  };
}

/**
 * 读取卡片模型（对齐 DSH read-card-model：result-side only——调用时无文件内容，
 * running 必返回 null；label 为 cwd 相对化路径）。
 * ELEVE 后端 content 可能已带行号前缀（`add_line_numbers`，如 "  12: text"），
 * 检测到则原样渲染不重复编号。
 */
export interface ReadCardModel {
  label: string;
  /** 行号（1 起，含 args.offset 页偏移）；后端已带行号时 number 为 0（渲染时跳过 gutter） */
  lines: { number: number; text: string }[];
  totalLines: number | null;
  truncated: boolean;
}

/**
 * 后端 `add_line_numbers` 生成 `{num}|{line}`（common.rs L917，竖线顶格无空格）；
 * 匹配则整段 content 已带行号，前端跳过 gutter 不重复编号。
 */
const LINE_NUMBERED_RE = /^\d+\|/;

export function readCardModel(
  toolName: string,
  args: unknown,
  parsedResult: unknown,
  cwd: string | undefined,
): ReadCardModel | null {
  // 仅 read_file（ELEVE 无 web_fetch 工具；网页抓取 web_extract 是文档抽取非行号内容）
  if (toolName !== 'read_file') return null;
  const res = parseArgs(parsedResult);
  const content = res ? cardField(res, ['content']) : '';
  if (!content) return null; // running / 空内容 → 通用体
  const argsRec = parseArgs(args);
  const rawLines = content.split('\n');
  const preNumbered = rawLines.length > 0 && LINE_NUMBERED_RE.test(rawLines[0]);
  const startLine = (() => {
    const offset = argsRec && typeof argsRec.offset === 'number' ? argsRec.offset : 1;
    return offset >= 1 ? Math.floor(offset) : 1;
  })();
  const lines = rawLines.map((text, i) => ({
    number: preNumbered ? 0 : startLine + i,
    text,
  }));
  const totalRaw = res && typeof res.total_lines === 'number' ? res.total_lines : null;
  return {
    label: relativizeToCwd(cardField(argsRec, ['path', 'file_path']), cwd),
    lines,
    totalLines: totalRaw,
    truncated: Boolean(res && res.truncated === true),
  };
}

// ── keyed 专属行视图（🔴 对齐 DSH toolviews keyed slot：todo-row / ask-question-row
//    模式——命中替换通用行的标题/摘要，行 chrome（sweep/展开/状态点）与展开体复用；
//    持久列表不在此双渲染（todo 列表在 HoistedTodoPanel，clarify 问答在 composer）。
//    ELEVE 无 slot 系统，用 keyed 纯函数表实现同等分发语义：toolName 命中 → 专属摘要，
//    未命中 → null（GenericToolCard 兜底语义）──

/** 专属行视图产出（纯数据；icon 属渲染域，由 ToolEntry 的覆盖表特判） */
export interface SpecializedRowModel {
  title: string;
  summary: string;
  /** 摘要外尾注（对齐 DSH summarySuffix：随行渲染但不参与 ellipsis 截断的关键计数） */
  summarySuffix: string | null;
}

/** todo 列表条目（后端 TodoItem：id/content/status，status 四值） */
interface TodoItemLike {
  content: string;
  status: string;
}

function todoItemsFrom(value: unknown): TodoItemLike[] | null {
  if (!Array.isArray(value)) return null;
  const items: TodoItemLike[] = [];
  for (const entry of value) {
    const rec = parseArgs(entry);
    if (!rec) return null;
    // 后端允许空 content（"Empty content = LLM didn't provide it"）——
    // 空条目保留计数，仅不参与"正在:"展示（todoRowModel 过滤）
    const content = cardField(rec, ['content']);
    const status = typeof rec.status === 'string' ? rec.status : 'pending';
    items.push({ content, status });
  }
  return items;
}

/**
 * todo 行摘要（对齐 DSH todo-row planSummary 语义）：
 * `已完成 2/5 · 正在: xxx`，并行活动数走 summarySuffix（窄行不裁剪的关键计数）。
 * args/result 都携带 todos（写前 args 即真相，落定 result 同构）。
 */
export function todoRowModel(
  args: unknown,
  parsedResult: unknown,
  state: ToolRowState,
): SpecializedRowModel | null {
  const items = todoItemsFrom(parseArgs(parsedResult)?.todos ?? parseArgs(args)?.todos);
  if (!items) return null;
  const total = items.length;
  const done = items.filter((i) => i.status === 'completed').length;
  const active = items.filter((i) => i.status === 'in_progress' && i.content);
  const head = state === 'running' ? `更新任务 ${done}/${total}` : `已完成 ${done}/${total}`;
  // 对齐 DSH："A cancelled call wrote no todo — it must not read as a completed update"
  if (state === 'error') return null;
  const activeContent = active.length > 0 ? active[0].content : '';
  const extra = Math.max(0, active.length - 1);
  return {
    title: '任务规划',
    summary: activeContent ? `${head} · 正在: ${truncateOneLine(activeContent, 60)}` : head,
    summarySuffix: extra > 0 ? `+${extra}` : null,
  };
}

/**
 * clarify 行摘要（对齐 DSH ask-question-row outcome 语义）：
 * running = 等待用户回答；ok = 已回答 N/M（user_response 非空计为已答，对齐后端
 * batch_row 未答 = ""）；timed_out 落在结果上时明示超时。
 */
export function clarifyRowModel(
  parsedResult: unknown,
  state: ToolRowState,
): SpecializedRowModel | null {
  if (state === 'running') {
    return { title: '澄清提问', summary: '等待用户回答…', summarySuffix: null };
  }
  if (state !== 'ok') return null; // 错误行走通用错误语义
  const res = parseArgs(parsedResult);
  if (!res) return null;
  const timedOut = res.timed_out === true;
  // 批量结构（对齐后端 execute_batch：{responses: [{question, user_response}], timed_out}）
  const responses = Array.isArray(res.responses) ? res.responses : null;
  if (responses) {
    const answered = responses.filter((r) => {
      const rec = parseArgs(r);
      return Boolean(rec && cardField(rec, ['user_response']));
    }).length;
    return {
      title: '澄清提问',
      summary: timedOut
        ? `已超时（回答 ${answered}/${responses.length}）`
        : `已回答 ${answered}/${responses.length}`,
      summarySuffix: null,
    };
  }
  // 单题结构（对齐后端 execute 单题路径：{question, choices_offered, user_response}；
  // multi_select 的 user_response 是数组）
  const rawResponse = res.user_response;
  const answered = Array.isArray(rawResponse)
    ? rawResponse.length > 0
    : typeof rawResponse === 'string' && rawResponse.trim() !== '';
  if (typeof rawResponse === 'string' || Array.isArray(rawResponse)) {
    return {
      title: '澄清提问',
      summary: timedOut ? '已超时（未收到回答）' : answered ? '已回答' : '未回答',
      summarySuffix: null,
    };
  }
  return null;
}

/**
 * delegate 行摘要（对齐后端 DelegateEnd summary 语义 delegate.rs L464-473）：
 * 单任务 = 其摘要一行；多任务 = `N 项任务: X 成功, Y 失败`；running = 执行中。
 * 嵌套子调用不进主会话事件流（隔离上下文），DSH subCalls 树无数据源——
 * 以任务结果卡（delegateCardModel）承担详情，行保持单行。
 */
export function delegateRowModel(
  parsedResult: unknown,
  state: ToolRowState,
): SpecializedRowModel | null {
  if (state === 'running') {
    return { title: '委派', summary: '子任务执行中…', summarySuffix: null };
  }
  if (state !== 'ok') return null;
  const res = parseArgs(parsedResult);
  const results = res && Array.isArray(res.results) ? res.results : null;
  if (!results || results.length === 0) return null;
  if (results.length === 1) {
    const rec = parseArgs(results[0]);
    const summary = rec ? cardField(rec, ['summary']) : '';
    const status = rec && typeof rec.status === 'string' ? rec.status : '';
    // 单任务无摘要时按状态给结论（对齐 DetailedResult.status 四值），不谎报"已完成"
    const fallback = status === 'completed' || status === ''
      ? '已完成 1 项任务'
      : `任务未完成（${delegateStatusLabel(status)}）`;
    return {
      title: '委派',
      summary: summary ? truncateOneLine(summary, 120) : fallback,
      summarySuffix: null,
    };
  }
  const completed = results.filter((r) => parseArgs(r)?.status === 'completed').length;
  const failed = results.length - completed;
  return {
    title: '委派',
    summary: `${results.length} 项任务: ${completed} 成功, ${failed} 失败`,
    summarySuffix: null,
  };
}

/** delegate 任务状态 → 中文标签（对齐 DetailedResult.status 四值；渲染层据此配色） */
export function delegateStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return '成功';
    case 'failed': return '失败';
    case 'interrupted': return '已中断';
    case 'error': return '错误';
    default: return status || '未知';
  }
}

/** keyed 分发表（对齐 DSH ToolCallTree renderSlot entryKey=toolName；null = 通用行兜底） */
export function specializedRowModel(
  toolName: string,
  args: unknown,
  parsedResult: unknown,
  state: ToolRowState,
): SpecializedRowModel | null {
  switch (toolName) {
    case 'todo':
      return todoRowModel(args, parsedResult, state);
    case 'clarify':
      return clarifyRowModel(parsedResult, state);
    case 'delegate_task':
      return delegateRowModel(parsedResult, state);
    default:
      return null;
  }
}

// ── delegate 展开体任务卡 ──

/** delegate 结果条目（DetailedResult 的 UI 消费子集） */
export interface DelegateTaskRow {
  index: number;
  status: string;
  summary: string;
  error: string;
  durationSeconds: number | null;
  model: string;
}

/** delegate 展开体卡片模型：任务列表（状态 + 摘要 + 时长/模型） */
export interface DelegateCardModel {
  tasks: DelegateTaskRow[];
}

export function delegateCardModel(parsedResult: unknown): DelegateCardModel | null {
  const res = parseArgs(parsedResult);
  const results = res && Array.isArray(res.results) ? res.results : null;
  if (!results || results.length === 0) return null;
  const tasks: DelegateTaskRow[] = [];
  for (const item of results) {
    const rec = parseArgs(item);
    if (!rec) continue;
    tasks.push({
      index: typeof rec.task_index === 'number' ? rec.task_index : tasks.length,
      status: typeof rec.status === 'string' ? rec.status : '',
      summary: cardField(rec, ['summary']),
      error: cardField(rec, ['error']),
      durationSeconds: typeof rec.duration_seconds === 'number' ? rec.duration_seconds : null,
      model: cardField(rec, ['model']),
    });
  }
  return tasks.length > 0 ? { tasks } : null;
}
