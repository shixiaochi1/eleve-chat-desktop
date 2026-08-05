/**
 * terminal-font — 终端字体系统（对齐 Hermes terminal-font.ts + use-terminal-font.ts）
 *
 * - 配置：config.yaml `terminal.font_family`（per-profile，走 config.get / config.set.raw）
 * - $terminalFontFamily 模块级状态（useSyncExternalStore 模式），面板/终端共享
 * - warmTerminalFontFamily：document.fonts.load 预热 WebGL 字形 atlas（挂载前）
 * - applyTerminalFontFamily：配置变化热切换（不重建 xterm/PTY）——warm + options +
 *   fit + clearTextureAtlas + refresh
 */
import { useSyncExternalStore } from 'react';
import { call } from '@/utils/bridge';

export const DEFAULT_TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace";

export const TERMINAL_FONT_SUGGESTIONS = [
  'MesloLGS NF',
  'JetBrainsMono Nerd Font',
  'CaskaydiaCove Nerd Font',
  'FiraCode Nerd Font',
  'Hack Nerd Font',
  'SauceCodePro Nerd Font',
  'JetBrains Mono',
  'SF Mono',
  'Menlo',
  'Cascadia Code',
] as const;

// ── 模块级状态（对齐 Hermes $terminalFontFamily atom）──
let terminalFontFamily = '';
const fontListeners = new Set<() => void>();
const emitFont = () => fontListeners.forEach((l) => l());

/** 订阅字体配置（useSyncExternalStore） */
export function subscribeTerminalFont(listener: () => void): () => void {
  fontListeners.add(listener);
  return () => {
    fontListeners.delete(listener);
  };
}

export function getTerminalFontSnapshot(): string {
  return terminalFontFamily;
}

export function setTerminalFontFamily(value: string): void {
  const next = normalizeTerminalFontFamily(value);
  if (next === terminalFontFamily) return;
  terminalFontFamily = next;
  emitFont();
}

/** useSyncExternalStore 消费（对齐 Hermes useStore($terminalFontFamily)） */
export function useTerminalFontConfigured(): string {
  return useSyncExternalStore(subscribeTerminalFont, getTerminalFontSnapshot);
}

// ── 归一化 / 解析 ──
export function normalizeTerminalFontFamily(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function quoteSingleFamily(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** 接受单个友好字体名或完整 CSS font stack；空 → 默认 */
export function resolveTerminalFontFamily(value: unknown): string {
  const configured = normalizeTerminalFontFamily(value);
  if (!configured) return DEFAULT_TERMINAL_FONT_FAMILY;
  const preferred = configured.includes(',') || /['"]/.test(configured) ? configured : quoteSingleFamily(configured);
  return `${preferred}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

// ── 字体预热 / 挂载准备 / 热切换（对齐 Hermes）──
type FontFaceLoader = Pick<FontFaceSet, 'load'>;

function browserFontSet(): FontFaceLoader | undefined {
  return typeof document === 'undefined' ? undefined : document.fonts;
}

/** WebGL 建字形 atlas 前预热每个字重 */
export async function warmTerminalFontFamily(
  fontFamily: string,
  fontSet: FontFaceLoader | undefined = browserFontSet(),
): Promise<void> {
  if (!fontSet?.load) return;
  await Promise.allSettled(
    ['400', '700', 'italic 400'].map((descriptor) =>
      Promise.resolve().then(() => fontSet.load(`${descriptor} 11px ${fontFamily}`)),
    ),
  );
}

/**
 * 等待最新请求的字体族再挂载 xterm（配置可能晚于组件渲染到达；
 * 防 WebGL 用陈旧 fallback 度量打开后立刻重建）
 */
export async function prepareTerminalFontFamily(
  getLatest: () => string,
  isCurrent: () => boolean,
  warm: (fontFamily: string) => Promise<void> = warmTerminalFontFamily,
): Promise<string | null> {
  let candidate = getLatest();
  while (isCurrent()) {
    await warm(candidate);
    if (!isCurrent()) return null;
    const latest = getLatest();
    if (latest === candidate) return candidate;
    candidate = latest;
  }
  return null;
}

export interface TerminalFontTarget {
  options: { fontFamily?: string };
  rows: number;
  refresh: (start: number, end: number) => void;
}

interface ApplyTerminalFontOptions {
  clearTextureAtlas: () => void;
  fit: () => void;
  fontFamily: string;
  isCurrent: () => boolean;
  term: TerminalFontTarget;
  warm?: (fontFamily: string) => Promise<void>;
}

/** 实时字体切换（不重建 xterm/PTY，对齐 Hermes applyTerminalFontFamily） */
export async function applyTerminalFontFamily({
  clearTextureAtlas,
  fit,
  fontFamily,
  isCurrent,
  term,
  warm = warmTerminalFontFamily,
}: ApplyTerminalFontOptions): Promise<boolean> {
  await warm(fontFamily);
  if (!isCurrent()) return false;
  term.options.fontFamily = fontFamily;
  fit();
  clearTextureAtlas();
  if (term.rows > 0) term.refresh(0, term.rows - 1);
  return true;
}

// ── 后端配置读写（config.yaml terminal.font_family，per-profile）──
/** 从后端 config.yaml 读字体配置（启动时调用一次） */
export async function loadTerminalFontFromConfig(): Promise<void> {
  try {
    const cfg = (await call('get_config', {})) as Record<string, unknown>;
    const terminal = cfg?.terminal as Record<string, unknown> | undefined;
    setTerminalFontFamily(normalizeTerminalFontFamily(terminal?.font_family));
  } catch {
    // 后端不可用 → 保持默认
  }
}

/** 写回 config.yaml（读-改-写合并，走 config.set.raw 对齐 Hermes saveHermesConfig） */
export async function saveTerminalFontToConfig(fontFamily: string): Promise<void> {
  const next = normalizeTerminalFontFamily(fontFamily);
  setTerminalFontFamily(next); // 本地先行（乐观）
  try {
    const cfg = ((await call('get_config', {})) as Record<string, unknown>) ?? {};
    const terminal = (cfg.terminal as Record<string, unknown>) ?? {};
    const updated = { ...cfg, terminal: { ...terminal, font_family: next } };
    await call('update_config', { config: updated });
  } catch (err) {
    console.error('[terminal-font] save failed:', err);
    throw err;
  }
}

/** 建议列表（设置面板 datalist） */
