/**
 * text — 文本字段/形态判定通用工具（🔴 严禁重复造轮子收敛点，对齐 Hermes
 * lib/text.ts "Canonical text micro-helpers. Do not redefine these per-page."）
 *
 * - normalize / asText：搜索键归一化（session-search 消费，Hermes 同款语义）
 * - firstStringField：取首个非空字符串字段（trim 版）；此前在 chat-messages /
 *   changed-files / ToolEntry 各有一份私有副本，统一收敛到此
 * - firstRawStringField：不 trim 版本——读取文件 content 等保真场景
 *   （trim 会吃掉首尾空白/空行，改变行数）
 * - truncateOneLine：单行压缩 + 截断（工具行摘要/参数尾巴共用）
 * - looksLikeUrl / looksLikePath：对齐 Hermes fallback-model/targets.ts 的目标形态判定
 */

/** 任意值 → 文本（null/undefined → 空串；对齐 Hermes asText） */
export const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 搜索键归一化：`asText(v).trim().toLowerCase()`（对齐 Hermes normalize；
 *  消费方 session-search 的 includes 匹配自行 toLowerCase 其值侧） */
export const normalize = (v: unknown): string => asText(v).trim().toLowerCase();

/** 值侧包含判断（对齐 Hermes includesQuery；query 需先经 normalize） */
export const includesQuery = (v: unknown, q: string): boolean => asText(v).toLowerCase().includes(q);

/** 取 record 中第一个非空字符串字段，返回 trim 后的值（对齐 Hermes firstStringField） */
export function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

/** 取 record 中第一个非空字符串字段，返回原值（不 trim——content 等保真场景） */
export function firstRawStringField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return '';
}

/** 压缩所有空白为单空格后截断（省略号计入宽度：max-1 字符 + …，对齐 Hermes compactPreview） */
export function truncateOneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** 🔴 对齐 Hermes fallback-model/targets.ts：可预览目标判定 */
export const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value);
export const looksLikePath = (value: string): boolean =>
  /^file:\/\//i.test(value) || /^(?:\/|\.{1,2}\/|~\/).+/.test(value);
