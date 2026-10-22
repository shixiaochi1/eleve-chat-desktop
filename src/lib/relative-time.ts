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

/**
 * 聊天列表角标时间（微信/IM 联系人行的右上角写法，比 `formatRelativeTime`
 * 更短，260px 侧栏放得下）：
 * - 今天 → `HH:mm`
 * - 昨天 → `昨天`
 * - 今年更早 → `M/D`
 * - 跨年 → `YYYY/M/D`
 */
export function formatChatListTime(
  input: number | null | undefined,
  now: number = Date.now(),
): string {
  if (!input || input <= 0) return '';
  const ms = input > 1e12 ? input : input * 1000;
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const isYesterday =
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate();
  if (isYesterday) return '昨天';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
