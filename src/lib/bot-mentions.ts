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
import { fetchUnionRoster } from '../services/bot-relay';

export interface MentionRow {
  handle: string;
  profile: string;
  displayName?: string;
  /** 远端行才有（本地行 undefined） */
  connectionId?: string;
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

let rosterCache: { rows: MentionRow[]; at: number } | null = null;
let rosterInFlight: Promise<MentionRow[]> | null = null;

/** 名册（本地 + 全部远端连接 union）；≤5s stale 直接应答（对齐 Hermes query cache） */
export function loadMentionRoster(): Promise<MentionRow[]> {
  if (rosterCache && Date.now() - rosterCache.at <= 5_000) {
    return Promise.resolve(rosterCache.rows);
  }
  if (rosterInFlight) return rosterInFlight;
  rosterInFlight = fetchUnionRoster()
    .then((rows) => {
      const mapped: MentionRow[] = rows.map((r) => ({
        handle: r.entry.handle,
        profile: r.entry.profile,
        displayName: r.entry.display_name || r.entry.handle,
        connectionId: r.isRemote ? r.connectionId : undefined,
        isRemote: r.isRemote,
      }));
      rosterCache = { rows: mapped, at: Date.now() };
      return mapped;
    })
    .catch(() => rosterCache?.rows ?? [])
    .finally(() => {
      rosterInFlight = null;
    });
  return rosterInFlight;
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
 * identification-only 注入行（对齐 Hermes middleware 语义：只告知"用户指的是谁"，
 * 是否投递/投递什么由 agent 决定；英文协议行与群聊成员 prompt 同风格）。
 */
export function buildIdentificationNote(hits: MentionRow[]): string {
  const names = hits
    .map((r) => (r.isRemote ? `@${r.handle}@${r.connectionId}` : `@${r.handle}`))
    .join(', ');
  return (
    `\n\n[User mention] The user is addressing: ${names}. ` +
    'They are teammates in your Bot Mode roster. Decide yourself whether and what ' +
    "to send them via the message_agent tool; never forward the user's message verbatim."
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
