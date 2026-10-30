/**
 * MCP 服务器的「高级配置」表单 ↔ `config.yaml` 条目互转（纯函数）。
 *
 * 抽成纯函数的原因：这段逻辑要同时满足三个约束，靠 UI 里散写的 setState 很难保证——
 *
 * 1. **不丢字段**：`mcp_servers.<name>` 里可能有表单不展示的键（`env`、`oauth`、
 *    `headers`、`identity_header`…）。保存时必须基于**当前**条目做增量覆盖，
 *    而不是用表单值重建整个对象。
 * 2. **空值要删键，不要写空值**：`include_tools: []` 和「没写」在运行时等价，但
 *    写进去会让用户以后翻配置时误以为"曾经配过"。
 * 3. **数字要有兜底**：输入框清空 / 输入非数字时不能写 `NaN` 或 `0`（0 在
 *    `idle_timeout` 里表示"永不回收"，语义与"没填"不同）。
 */

/** 表单里的原始文本状态（数字也用字符串装，避免受控输入打架）。 */
export interface AdvancedDraft {
  lazy: boolean;
  idleTimeout: string;
  include: string;
  exclude: string;
  samplingEnabled: boolean;
  samplingModel: string;
  samplingMaxRequests: string;
  samplingMaxTokens: string;
  samplingTimeout: string;
  elicitationEnabled: boolean;
  elicitationTimeout: string;
}

/** 各字段的语义默认值（与后端 `McpSamplingPolicy` / `McpElicitationPolicy` 对齐）。 */
export const DEFAULTS = {
  samplingMaxRequests: 20,
  samplingMaxTokens: 512,
  samplingTimeout: 30,
  elicitationTimeout: 300,
};

export const EMPTY_DRAFT: AdvancedDraft = {
  lazy: false,
  idleTimeout: '',
  include: '',
  exclude: '',
  samplingEnabled: false,
  samplingModel: '',
  samplingMaxRequests: String(DEFAULTS.samplingMaxRequests),
  samplingMaxTokens: String(DEFAULTS.samplingMaxTokens),
  samplingTimeout: String(DEFAULTS.samplingTimeout),
  elicitationEnabled: false,
  elicitationTimeout: String(DEFAULTS.elicitationTimeout),
};

/** 逗号/空白分隔的列表 → 去空去重的字符串数组。 */
export function parseList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，\s]+/)) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function readNumber(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/** 从配置条目还原表单状态（缺失字段用默认值/空串）。 */
export function draftFromEntry(entry: Record<string, any> | undefined): AdvancedDraft {
  const e = entry || {};
  const sampling = e.sampling && typeof e.sampling === 'object' ? e.sampling : undefined;
  const elicitation = e.elicitation && typeof e.elicitation === 'object' ? e.elicitation : undefined;

  const timeoutOf = (v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '');

  // 🔴 过滤器有两种写法：扁平 `include_tools` 与嵌套 `tools.include`
  // （Hermes 迁移配置多为后者，且**嵌套优先**）。表单必须读嵌套，否则会显示为空，
  // 用户以为没配过滤，保存后把嵌套段写回扁平键——被忽略且看不出来。
  const nested = e.tools && typeof e.tools === 'object' ? e.tools : undefined;
  const includeList = Array.isArray(nested?.include)
    ? nested.include
    : Array.isArray(e.include_tools)
      ? e.include_tools
      : [];
  const excludeList = Array.isArray(nested?.exclude)
    ? nested.exclude
    : Array.isArray(e.exclude_tools)
      ? e.exclude_tools
      : [];

  return {
    lazy: e.lazy === true,
    idleTimeout: typeof e.idle_timeout === 'number' && e.idle_timeout > 0 ? String(e.idle_timeout) : '',
    include: includeList.join(', '),
    exclude: excludeList.join(', '),
    samplingEnabled: sampling?.enabled === true,
    samplingModel: typeof sampling?.model === 'string' ? sampling.model : '',
    samplingMaxRequests: sampling ? String(sampling.max_requests ?? DEFAULTS.samplingMaxRequests) : String(DEFAULTS.samplingMaxRequests),
    samplingMaxTokens: sampling ? String(sampling.max_tokens ?? DEFAULTS.samplingMaxTokens) : String(DEFAULTS.samplingMaxTokens),
    samplingTimeout: sampling ? String(sampling.timeout_secs ?? DEFAULTS.samplingTimeout) : String(DEFAULTS.samplingTimeout),
    elicitationEnabled: elicitation?.enabled === true,
    elicitationTimeout: elicitation ? String(elicitation.timeout_secs ?? DEFAULTS.elicitationTimeout) : String(DEFAULTS.elicitationTimeout),
  };
}

/**
 * 把表单状态合并进**当前条目**，返回新对象（不修改入参）。
 *
 * 未在表单中出现的键（`command` / `args` / `env` / `url` / `oauth` / `headers` …）
 * 原样保留——这些是服务器的连接身份，被表单覆盖掉会直接连不上。
 */
export function applyDraft(
  current: Record<string, any> | undefined,
  draft: AdvancedDraft,
): Record<string, any> {
  const next: Record<string, any> = { ...(current || {}) };

  // lazy：false 是默认值，不写键（避免每个条目都多一行噪声）
  if (draft.lazy) next.lazy = true;
  else delete next.lazy;

  const idle = readNumber(draft.idleTimeout, 0);
  if (idle > 0) next.idle_timeout = idle;
  else delete next.idle_timeout;

  const include = parseList(draft.include);
  const exclude = parseList(draft.exclude);

  // 写回**与读取同源**的那一处：嵌套 `tools` 存在时改嵌套（扁平键会被运行时忽略），
  // 否则改扁平键。两边都写会让以后改配置的人分不清哪份生效。
  const nestedTools =
    next.tools && typeof next.tools === 'object' && !Array.isArray(next.tools)
      ? { ...next.tools }
      : undefined;

  if (nestedTools) {
    if (include.length > 0) nestedTools.include = include;
    else delete nestedTools.include;
    if (exclude.length > 0) nestedTools.exclude = exclude;
    else delete nestedTools.exclude;

    if (Object.keys(nestedTools).length > 0) next.tools = nestedTools;
    else delete next.tools;
    // 扁平键留着会迷惑读者（运行时不看它们），一并清掉
    delete next.include_tools;
    delete next.exclude_tools;
  } else {
    if (include.length > 0) next.include_tools = include;
    else delete next.include_tools;
    if (exclude.length > 0) next.exclude_tools = exclude;
    else delete next.exclude_tools;
  }

  if (draft.samplingEnabled) {
    const sampling: Record<string, any> = {
      enabled: true,
      max_requests: readNumber(draft.samplingMaxRequests, DEFAULTS.samplingMaxRequests),
      max_tokens: readNumber(draft.samplingMaxTokens, DEFAULTS.samplingMaxTokens),
      timeout_secs: readNumber(draft.samplingTimeout, DEFAULTS.samplingTimeout),
    };
    const model = draft.samplingModel.trim();
    if (model) sampling.model = model;
    next.sampling = sampling;
  } else {
    delete next.sampling;
  }

  if (draft.elicitationEnabled) {
    next.elicitation = {
      enabled: true,
      timeout_secs: readNumber(draft.elicitationTimeout, DEFAULTS.elicitationTimeout),
    };
  } else {
    delete next.elicitation;
  }

  return next;
}

/** 表单是否有实质改动（用于禁用"保存"按钮）。 */
export function isDraftDirty(draft: AdvancedDraft, current: Record<string, any> | undefined): boolean {
  return JSON.stringify(applyDraft(current, draft)) !== JSON.stringify(current || {});
}
