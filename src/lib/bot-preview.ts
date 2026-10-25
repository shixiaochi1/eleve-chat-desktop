/**
 * bot-preview — Bot 私聊 / 联系人行的末条消息预览。
 *
 * 对齐 Hermes `plugins/hermes-bots/row-helpers.ts`：
 * - `A2A_PREFIX_RE` 剥掉 bot-to-bot 投递前缀（`Message from 🤖 name (@handle): `
 *   与旧式 `[Message from agent 'name']`），私聊预览才会读起来像一条私信，
 *   而不是一行日志。
 * - 会话流里的换行/连续空白压平成一行（预览行是单行截断）。
 *
 * 为什么不复用 `chat-messages.ts`：那里消费的是结构化 `SessionMessage`
 * （role / display_kind / parts），而这里只有花名册的 `last_message.text`
 * 纯文本；用它的入口会把整条会话消息投影管线拉进侧栏行。
 */

/** 与 Hermes `row-helpers.ts:20-23` 同形的投递前缀；额外兼容 ELEVE
 *  `chat-messages.ts` 仍在识别的旧式方括号形
 *  （`[Message from agent 'Scout']`——Hermes 正则不含方括号，但存量会话有）。 */
const A2A_PREFIX_RE =
  /^(?:\[Message from agent '[^']+'\]|Message from (?:agent '[^']+':|🤖[^:]+:))\s*/i;

/** 预览截断（字符数，按码点计——emoji 不会被切成半个）。 */
export const BOT_PREVIEW_MAX_CHARS = 80;

/** 末条消息文本 → 单行预览（空输入 = 空串，调用方自行给占位文案）。 */
export function formatBotPreview(text: string | null | undefined): string {
  const raw = (text || '').trim();
  if (!raw) return '';
  const body = raw
    .replace(A2A_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(body);
  return chars.length > BOT_PREVIEW_MAX_CHARS
    ? `${chars.slice(0, BOT_PREVIEW_MAX_CHARS).join('')}…`
    : body;
}
