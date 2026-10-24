/**
 * bot-mentions — 主聊天 composer 的 @bot mention（对齐 Hermes DF3，2026-09-08）
 *
 * Hermes 契约（hermes-bot-mode-system-map 10.2 DF3 + plugin.tsx）：
 * - 任意 composer 打 `@` 弹 roster 句柄（**query cache 同步应答 ≤5s stale**）
 * - mention middleware = **identification-only**：把 draft 中 @bot 改写注入
 *   "用户指的是谁"提示行，**从不自己投递**——投递由 agent 自己决定
 *   （message_agent 工具），绝不代发、不改写用户原话
 *
 * ELEVE 形态：lib 层纯函数 + 5s stale 名册缓存。
 * 消费方：usePromptActions.handleSend（发送链注入）+ InputArea（@ 补全浮层）。
 * 群聊不经此路径（BotsRoomView 有自己的 mention 解析 + 后端 resolve_mentions）。
 */
import { getUnionRoster, isUnionFresh, refreshUnionRoster, type UnionRosterRow } from '../plugins/bots/state';

export interface MentionRow {
  handle: string;
  profile: string;
  displayName?: string;
  /** 远端行才有（本地行 undefined） */
  connectionId?: string;
  /** 连接展示名（远端行标记用，对齐 UnionRosterRow.connectionLabel） */
  connectionLabel?: string;
  isRemote: boolean;
}

/** ELEVE composer 既有 @ directive（F3 路径补全 / url 引用）——不是 mention */
const DIRECTIVE_PREFIXES = ['@file:', '@folder:', '@url:', '@line:'];

/** 提取 draft 中的 @token（排除既有 directive） */
export function extractMentionTokens(text: string): string[] {
  const tokens = text.match(/@[\w\u4e00-\u9fa5-]+/g) || [];
  return tokens.filter(
    (t) => !DIRECTIVE_PREFIXES.some((p) => t.toLowerCase().startsWith(p)),
  );
}

function toMentionRows(rows: UnionRosterRow[]): MentionRow[] {
  return rows.map((r) => ({
    handle: r.entry.handle,
    profile: r.entry.profile,
    displayName: r.entry.display_name || r.entry.handle,
    connectionId: r.isRemote ? r.connectionId : undefined,
    connectionLabel: r.isRemote ? r.connectionLabel : undefined,
    isRemote: r.isRemote,
  }));
}

/** 名册（本地 + 全部远端连接 union）。
 * 🔴 round-78：读插件 store（此前本模块自持 5s cache + 独立在飞 Promise
 * ——四路拉取之一）；≤5s stale 直接应答（对齐 Hermes query cache 语义不变），
 * 超龄触发 store 刷新，失败降级 last-good。 */
export function loadMentionRoster(): Promise<MentionRow[]> {
  const current = getUnionRoster();
  if (current.length && isUnionFresh(5_000)) {
    return Promise.resolve(toMentionRows(current));
  }
  return refreshUnionRoster()
    .then(toMentionRows)
    .catch(() => toMentionRows(getUnionRoster()));
}

/** draft 中命中的队友（handle/profile 大小写不敏感精确匹配；@all/@everyone 非队友） */
export function matchMentionRows(text: string, rows: MentionRow[]): MentionRow[] {
  const tokens = extractMentionTokens(text).map((t) => t.slice(1).toLowerCase());
  if (!tokens.length) return [];
  const seen = new Set<string>();
  const hits: MentionRow[] = [];
  for (const row of rows) {
    const key = `${row.profile}@${row.connectionId ?? ''}`;
    if (seen.has(key)) continue;
    if (tokens.includes(row.handle.toLowerCase()) || tokens.includes(row.profile.toLowerCase())) {
      seen.add(key);
      hits.push(row);
    }
  }
  return hits;
}

/**
 * identification-only 注入行（🔴 2026-10-24 对齐审查 A4：逐字对齐 Hermes
 * plugin.tsx:851-882 的 middleware 形态——此前只列 @handle 名单，缺逐 bot
 * 解析行与"无 message_agent 工具就明说"兜底）：
 * - 每行给出 agent 身份解析（profile + 友好名 + 跨连接来源），让 agent 确切
 *   知道 "@research-buddy" 是谁；
 * - message_agent 只解析 canonical 身份：本地裸 profile、远端
 *   `profile@connectionId`（relay 花名册寻址）——UI 别名（handle 与 profile
 *   不同）单独标注 target，否则 agent 拿别名去投递会被解析器拒绝；
 * - 是否投递/投递什么由 agent 决定，**从不代发、不改写用户原话**。
 */
export function buildIdentificationNote(hits: MentionRow[]): string {
  const lines = hits.map((r) => {
    const handle = r.handle || r.profile;
    // 友好名（display_name 缺省时 = handle，此时不重复展示）
    const title = r.displayName && r.displayName !== handle ? ` ("${r.displayName}")` : '';
    const target = r.isRemote && r.connectionId ? `${r.profile}@${r.connectionId}` : r.profile;
    const where = r.isRemote
      ? ` — on ${r.connectionLabel || r.connectionId} (message_agent target: "${target}")`
      : handle !== target
        ? ` (message_agent target: "${target}")`
        : '';
    return `@${handle} = agent profile "${r.profile}"${title}${where}`;
  });
  return (
    '\n\n[@mentions resolved from the Bot Mode roster — the user is referring to: ' +
    lines.join('; ') +
    '. If they want one of these agents contacted, compose your own message and send it ' +
    'with your message_agent tool (agents on other connected machines are reachable too — ' +
    'the Desktop relays it); never forward the user’s text verbatim. If this session has ' +
    'no message_agent tool, agent messaging is unavailable here — say so.]'
  );
}

/** 发送链注入入口：@ 命中队友 → 附加 identification 行；否则原样返回（never throws） */
export async function annotateBotMentions(text: string): Promise<string> {
  try {
    if (!text.includes('@')) return text;
    const rows = await loadMentionRoster();
    const hits = matchMentionRows(text, rows);
    if (!hits.length) return text;
    return text + buildIdentificationNote(hits);
  } catch {
    return text;
  }
}
