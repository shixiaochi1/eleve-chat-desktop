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

/** 秒归一（比较/差值用）：毫秒（≥1e12）÷1000 转秒，秒原样。toMs 的对偶 */
export function toSeconds(ts: number): number {
  return ts < 1e12 ? ts : ts / 1000
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

/**
 * 短日期时间（MM/DD HH:mm，zh-CN 2-digit）— 上次运行时间等紧凑场景。
 * 🔴 2026-09-01 收敛：原 CronPanel 局部 formatTime 的格式化实现（调用方
 * 保留 null 兜底与 NaN 原串返回等业务语义）。
 */
export function formatShortDateTime(d: Date): string {
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
