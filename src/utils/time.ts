/**
 * 消息时间格式化
 * 格式：2026年7月28日 5:32（月/日/时不补零，分钟补零）
 *
 * 🔴 2026-08-10 修复 1970 bug：后端消息 timestamp 为 Unix 秒（f64，
 * session_db.rs as_secs_f64()），此前直接 new Date(秒) 把秒当毫秒 → 1970。
 * 统一入口：秒（< 1e12）自动 ×1000 转毫秒，毫秒原样透传。
 */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

export function formatMessageTime(ts: number): string {
  const d = new Date(toMs(ts))
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${h}:${m}`
}

/**
 * 消息区中间时间戳分隔（2026-08-10 新增）：
 * 当天只显「5:32」，跨天加「8月10日 5:32」，跨年加年份。
 */
export function formatTimeSeparator(ts: number): string {
  const d = new Date(toMs(ts))
  const now = new Date()
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return hm
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}
