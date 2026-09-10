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

/**
 * 侧栏行的紧凑年龄（"刚刚" / "3分钟前" / "5小时前" / "2天前" / "9月8日"）。
 * 入参 Unix **秒**（与后端 created_at / last_at 同源）。
 *
 * 🔴 round-95：由 SessionsPanel 的局部 `fmtTime` 上提为共享实现——Bots 左栏的
 * 群聊行与同一左栏的会话行必须对"多久之前"说同一种话（对齐 Hermes
 * bot-row.tsx `rowAge` 的注释：刻意复用会话行的 coarseElapsed + 后缀，免得
 * 一条侧栏里两套拼法）。SessionsPanel 侧改为 import 别名，行为零变化。
 */
export function formatRowAge(ts: number | null | undefined): string {
  if (!ts) return '';
  const now = Date.now();
  const then = new Date(toSeconds(ts) * 1000);
  const diffMin = Math.floor((now - then.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  const sameYear = then.getFullYear() === new Date().getFullYear();
  const mm = then.getMonth() + 1;
  const dd = then.getDate();
  if (sameYear) return `${mm}月${dd}日`;
  return `${then.getFullYear()}年${mm}月${dd}日`;
}
