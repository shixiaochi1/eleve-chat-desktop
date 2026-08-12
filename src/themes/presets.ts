/**
 * 6 套主题定义 — 对齐 Hermes Agent 桌面端
 *
 * 每套主题自带固定明暗属性（由背景色亮度自动判定）。
 * 用户只需选主题，不需要单独切 light/dark。
 */

import type { DesktopTheme, DesktopThemeTypography } from './types'

const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
  EMOJI_FALLBACK

const SYSTEM_MONO = 'Menlo, Monaco, "SF Mono", "Courier Prime", monospace, ' + EMOJI_FALLBACK

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = { fontSans: SYSTEM_SANS, fontMono: SYSTEM_MONO }

// ════════════════════════════════════════════════════════════
//  1. Default — 经典蓝（浅色）
// ════════════════════════════════════════════════════════════
export const nousTheme: DesktopTheme = {
  name: 'default',
  label: 'Default',
  description: '经典蓝色调',
  colors: {
    background: '#f8faff',
    foreground: '#17171a',
    card: '#ffffff',
    cardForeground: '#17171a',
    muted: 'color-mix(in srgb, #3b82f6 5%, #ffffff)',
    mutedForeground: '#666678',
    popover: '#ffffff',
    popoverForeground: '#17171a',
    primary: '#3b82f6',
    primaryForeground: '#fcfcfc',
    secondary: 'color-mix(in srgb, #3b82f6 7%, #ffffff)',
    secondaryForeground: '#242432',
    accent: 'color-mix(in srgb, #3b82f6 10%, #ffffff)',
    accentForeground: '#202030',
    border: 'color-mix(in srgb, #3b82f6 22%, transparent)',
    input: 'color-mix(in srgb, #3b82f6 30%, transparent)',
    ring: '#3b82f6',
    midground: '#3b82f6',
    composerRing: '#3b82f6',
    destructive: '#cf2d56',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#f0f4fb',
    sidebarBorder: 'color-mix(in srgb, #3b82f6 18%, transparent)',
    userBubble: 'color-mix(in srgb, #3b82f6 6%, #ffffff)',
    userBubbleBorder: 'color-mix(in srgb, #3b82f6 24%, transparent)',
  },
}

// ════════════════════════════════════════════════════════════
//  2. Midnight — 深蓝紫（深色）
// ════════════════════════════════════════════════════════════
export const midnightTheme: DesktopTheme = {
  name: 'midnight',
  label: 'Midnight',
  description: '深蓝紫深色',
  colors: {
    background: '#08081c',
    foreground: '#ddd6ff',
    card: '#0d0d28',
    cardForeground: '#ddd6ff',
    muted: '#13133a',
    mutedForeground: '#7c7ab0',
    popover: '#0f0f2e',
    popoverForeground: '#ddd6ff',
    primary: '#ddd6ff',
    primaryForeground: '#08081c',
    secondary: '#1a1a4a',
    secondaryForeground: '#c4bff0',
    accent: '#1a1a44',
    accentForeground: '#d0c8ff',
    border: '#1e1e52',
    input: '#1e1e52',
    ring: '#8b80e8',
    midground: '#8b80e8',
    composerRing: '#8b80e8',
    destructive: '#b03060',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#06061a',
    sidebarBorder: '#12123a',
    userBubble: '#14143a',
    userBubbleBorder: '#242466',
  },
  typography: {
    fontMono: '"JetBrains Mono", ' + SYSTEM_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap',
  },
}

// ════════════════════════════════════════════════════════════
//  3. Ember — 暖红铜（深色）
// ════════════════════════════════════════════════════════════
export const emberTheme: DesktopTheme = {
  name: 'ember',
  label: 'Ember',
  description: '暖红铜深色',
  colors: {
    background: '#160800',
    foreground: '#ffd8b0',
    card: '#1e0e04',
    cardForeground: '#ffd8b0',
    muted: '#2a1408',
    mutedForeground: '#aa7a56',
    popover: '#221008',
    popoverForeground: '#ffd8b0',
    primary: '#ffd8b0',
    primaryForeground: '#160800',
    secondary: '#341800',
    secondaryForeground: '#f0c090',
    accent: '#301600',
    accentForeground: '#e8c080',
    border: '#3a1c08',
    input: '#3a1c08',
    ring: '#d97316',
    midground: '#d97316',
    composerRing: '#d97316',
    destructive: '#c43010',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#100600',
    sidebarBorder: '#2a1004',
    userBubble: '#2a1000',
    userBubbleBorder: '#4a2010',
  },
  typography: {
    fontMono: '"IBM Plex Mono", ' + SYSTEM_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap',
  },
}

// ════════════════════════════════════════════════════════════
//  4. Mono — 纯灰度（深色）
// ════════════════════════════════════════════════════════════
export const monoTheme: DesktopTheme = {
  name: 'mono',
  label: 'Mono',
  description: '纯灰度深色',
  colors: {
    background: '#0e0e0e',
    foreground: '#eaeaea',
    card: '#141414',
    cardForeground: '#eaeaea',
    muted: '#1e1e1e',
    mutedForeground: '#808080',
    popover: '#181818',
    popoverForeground: '#eaeaea',
    primary: '#eaeaea',
    primaryForeground: '#0e0e0e',
    secondary: '#262626',
    secondaryForeground: '#c8c8c8',
    accent: '#222222',
    accentForeground: '#d8d8d8',
    border: '#2a2a2a',
    input: '#2a2a2a',
    ring: '#9a9a9a',
    midground: '#9a9a9a',
    composerRing: '#9a9a9a',
    destructive: '#a84040',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0a0a0a',
    sidebarBorder: '#202020',
    userBubble: '#1a1a1a',
    userBubbleBorder: '#363636',
  },
}

// ════════════════════════════════════════════════════════════
//  5. Cyberpunk — 霓虹绿黑（深色）
// ════════════════════════════════════════════════════════════
export const cyberpunkTheme: DesktopTheme = {
  name: 'cyberpunk',
  label: 'Cyberpunk',
  description: '霓虹绿黑深色',
  colors: {
    background: '#000a00',
    foreground: '#00ff41',
    card: '#001200',
    cardForeground: '#00ff41',
    muted: '#001a00',
    mutedForeground: '#1a8a30',
    popover: '#001000',
    popoverForeground: '#00ff41',
    primary: '#00ff41',
    primaryForeground: '#000a00',
    secondary: '#002800',
    secondaryForeground: '#00cc34',
    accent: '#002000',
    accentForeground: '#00e038',
    border: '#003000',
    input: '#003000',
    ring: '#00ff41',
    midground: '#00ff41',
    composerRing: '#00ff41',
    destructive: '#ff003c',
    destructiveForeground: '#000a00',
    sidebarBackground: '#000600',
    sidebarBorder: '#001800',
    userBubble: '#001400',
    userBubbleBorder: '#004800',
  },
  typography: {
    fontMono: '"Courier New", Courier, monospace, ' + EMOJI_FALLBACK,
    fontSans: '"Courier New", Courier, monospace, ' + EMOJI_FALLBACK,
  },
}

// ════════════════════════════════════════════════════════════
//  6. Slate — 冷岩蓝（深色）
// ════════════════════════════════════════════════════════════
export const slateTheme: DesktopTheme = {
  name: 'slate',
  label: 'Slate',
  description: '冷岩蓝深色',
  colors: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    card: '#161b22',
    cardForeground: '#c9d1d9',
    muted: '#21262d',
    mutedForeground: '#8b949e',
    popover: '#1c2128',
    popoverForeground: '#c9d1d9',
    primary: '#c9d1d9',
    primaryForeground: '#0d1117',
    secondary: '#2a3038',
    secondaryForeground: '#adb5bf',
    accent: '#1e2530',
    accentForeground: '#c0c8d0',
    border: '#30363d',
    input: '#30363d',
    ring: '#58a6ff',
    midground: '#58a6ff',
    composerRing: '#58a6ff',
    destructive: '#cf4848',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#090d13',
    sidebarBorder: '#1c2228',
    userBubble: '#1e2a38',
    userBubbleBorder: '#2e4060',
  },
  typography: {
    fontMono: '"JetBrains Mono", ' + SYSTEM_MONO,
  },
}

// ════════════════════════════════════════════════════════════
//  7. Glass — 毛玻璃渐变
// ════════════════════════════════════════════════════════════
/**
 * Frosted glass theme on the Default palette.
 *
 * Design:
 * - Backplate: subtle gradient (not a flat color) so blur has depth to reveal.
 * - Surfaces (card, sidebar, popover, bubbles): translucent with
 *   backdrop-filter: blur — the browser GPU-composites the layer behind,
 *   blurs it, then paints the semi-transparent glass on top.
 * - Performance: single 12px blur per surface (GPU-accelerated on all modern
 *   browsers), no animated backdrops, CSS `contain` on the root glass layer
 *   isolates compositing.
 *
 * The backdrop-filter CSS is injected at runtime only when this theme is
 * active (see applyThemeCSS in context.tsx — the .glass-mode class).
 */
export const glassTheme: DesktopTheme = {
  name: 'glass',
  label: 'Glass',
  description: '毛玻璃渐变效果',
  colors: {
    // 背板和 Default 同色 — 渐变由 CSS .glass-mode 注入
    background: '#f8faff',
    foreground: '#17171a',
    // 真正透明的玻璃表面 — 0.5~0.65 透明度让渐变背板清晰透出
    card: 'rgba(255, 255, 255, 0.55)',
    cardForeground: '#17171a',
    muted: 'rgba(59, 130, 246, 0.06)',
    mutedForeground: '#666678',
    popover: 'rgba(255, 255, 255, 0.65)',
    popoverForeground: '#17171a',
    primary: '#3b82f6',
    primaryForeground: '#fcfcfc',
    secondary: 'rgba(59, 130, 246, 0.08)',
    secondaryForeground: '#242432',
    accent: 'rgba(59, 130, 246, 0.12)',
    accentForeground: '#202030',
    border: 'rgba(255, 255, 255, 0.18)',
    input: 'rgba(255, 255, 255, 0.12)',
    ring: '#3b82f6',
    midground: '#3b82f6',
    composerRing: '#3b82f6',
    destructive: '#cf2d56',
    destructiveForeground: '#ffffff',
    sidebarBackground: 'rgba(255, 255, 255, 0.50)',
    sidebarBorder: 'rgba(255, 255, 255, 0.15)',
    userBubble: 'rgba(255, 255, 255, 0.45)',
    userBubbleBorder: 'rgba(255, 255, 255, 0.20)',
  },
}

// ════════════════════════════════════════════════════════════
//  导出
// ════════════════════════════════════════════════════════════

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  default: nousTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  cyberpunk: cyberpunkTheme,
  slate: slateTheme,
  glass: glassTheme,
}

export const BUILTIN_THEME_LIST: DesktopTheme[] = [
  nousTheme,
  midnightTheme,
  emberTheme,
  monoTheme,
  cyberpunkTheme,
  slateTheme,
  glassTheme,
]

/** 默认主题 */
export const DEFAULT_SKIN_NAME = 'default'
