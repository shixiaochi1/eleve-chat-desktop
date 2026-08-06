/**
 * text.ts — 通用文本微工具（对齐 Hermes apps/desktop/src/lib/text.ts）
 *
 * Hermes 原话："Canonical text micro-helpers. Do not redefine these per-page."
 * normalize 是约 30 处 filter/lookup 的搜索键归一化惯例，单一权威源。
 */

export const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const includesQuery = (v: unknown, q: string): boolean => asText(v).toLowerCase().includes(q);

/** 搜索键归一化：value.trim().toLowerCase()（Hermes normalize 同款） */
export const normalize = (v: unknown): string => asText(v).trim().toLowerCase();
