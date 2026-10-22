/**
 * 相对时间格式化（Agent 行 / 会话行的"最近活动"）。
 *
 * 单一实现：此前前端各处自己拼 `new Date(...).toLocaleString()` 或干脆不显示，
 * 导致同一份 roster 数据在不同面板呈现不一致。纯函数，可单测。
 */
export function formatRelativeTime(
  input: number | null | undefined,
  now: number = Date.now(),
): string {
  if (!input || input <= 0) return '';
  // 秒级 / 毫秒级自适应：epoch 秒 ≈ 1e9，毫秒 ≈ 1e12
  const ms = input > 1e12 ? input : input * 1000;
  const diff = Math.max(0, now - ms);
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 2 * DAY) return '昨天';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
