/**
 * 🔴 2026-10-24（前端对齐 Hermes `group-slash.ts:5-18`）：
 * 群聊房间**不能派发斜杠命令**——房间消息会原样进入每个成员的 prompt，
 * `/compress` 之类的命令文本会被成员当成普通内容（或误配）。
 *
 * Hermes 原文：*"Group rooms cannot dispatch slash commands. Keep
 * command-shaped input out of member prompts without rejecting paths such as
 * /etc/hosts."* —— 判据是"命令形状"（`/` + 单词 + 空白/结尾），
 * 所以 `/etc/hosts`、`/api/sessions` 这类路径不受影响。
 */
export function isGroupSlashCommand(text: string): boolean {
  return /^\/[a-z][\w-]*(?:\s|$)/i.test(text.trim());
}

/** 群聊斜杠命令的统一提示（对齐 Hermes i18n `slashCommandsUnsupported`）。 */
export const GROUP_SLASH_UNSUPPORTED =
  '群聊不支持斜杠命令。请打开单个机器人的聊天来使用。';
