/**
 * 消息时间格式化
 * 格式：2026年7月28日 5:32（月/日/时不补零，分钟补零）
 */
export function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${h}:${m}`;
}
