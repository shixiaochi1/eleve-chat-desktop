/**
 * 消息时间格式化 — Telegram 风格
 * 今天 → HH:MM ｜ 今年 → MM-DD HH:MM ｜ 更早 → YYYY-MM-DD HH:MM
 */
export function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return hm;

  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;

  return `${d.getFullYear()}-${md} ${hm}`;
}
