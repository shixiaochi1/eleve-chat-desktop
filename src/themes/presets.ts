/**
 * 7 套主题定义
 *
 * 每套主题自带固定明暗属性（由背景色亮度自动判定）。
 * 用户只需选主题，不需要单独切 light/dark。
 */

import type { DesktopTheme, DesktopThemeTypography } from './types'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif'

const SYSTEM_MONO = '"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace'

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
    muted: 'color-mix(in srgb, #0053fd 5%, #ffffff)',
    mutedForeground: '#666678',
    popover: '#ffffff',
    popoverForeground: '#17171a',
    primary: '#0053fd',
    primaryForeground: '#fcfcfc',
    secondary: 'color-mix(in srgb, #0053fd 7%, #ffffff)',
    secondaryForeground: '#242432',
    accent: 'color-mix(in srgb, #0053fd 10%, #ffffff)',
    accentForeground: '#202030',
    border: 'color-mix(in srgb, #0053fd 22%, transparent)',
    input: 'color-mix(in srgb, #0053fd 30%, transparent)',
    ring: '#0053fd',
    midground: '#0053fd',
    composerRing: '#0053fd',
    destructive: '#cf2d56',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#f0f4fb',
    sidebarBorder: 'color-mix(in srgb, #0053fd 18%, transparent)',
    userBubble: 'color-mix(in srgb, #0053fd 6%, #ffffff)',
    userBubbleBorder: 'color-mix(in srgb, #0053fd 24%, transparent)',
  },
}

// ════════════════════════════════════════════════════════════
//  2. Ocean — 深蓝
// ════════════════════════════════════════════════════════════
export const oceanTheme: DesktopTheme = {
  name: 'ocean',
  label: 'Ocean',
  description: '深蓝色调',
  colors: {
    background: '#0a1628',
    foreground: '#e0f2fe',
    card: '#0f1f38',
    cardForeground: '#e0f2fe',
    muted: '#132848',
    mutedForeground: '#7dd3fc',
    popover: '#132848',
    popoverForeground: '#e0f2fe',
    primary: '#38bdf8',
    primaryForeground: '#0a1628',
    secondary: '#0c2a4a',
    secondaryForeground: '#bae6fd',
    accent: 'rgba(56, 189, 248, 0.12)',
    accentForeground: '#bae6fd',
    border: '#1e3a5f',
    input: '#0c2a4a',
    ring: '#38bdf8',
    midground: '#38bdf8',
    composerRing: '#38bdf8',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0c1a30',
    sidebarBorder: '#1e3a5f',
    userBubble: '#0f2848',
    userBubbleBorder: '#1e4a7f',
  },
}

// ════════════════════════════════════════════════════════════
//  3. Forest — 深绿
// ════════════════════════════════════════════════════════════
export const forestTheme: DesktopTheme = {
  name: 'forest',
  label: 'Forest',
  description: '深绿色调',
  colors: {
    background: '#0a1a12',
    foreground: '#d6f3e0',
    card: '#0f2418',
    cardForeground: '#d6f3e0',
    muted: '#133020',
    mutedForeground: '#6ebe96',
    popover: '#133020',
    popoverForeground: '#d6f3e0',
    primary: '#52b788',
    primaryForeground: '#0a1a12',
    secondary: '#0f2e1e',
    secondaryForeground: '#95d5b2',
    accent: 'rgba(82, 183, 136, 0.12)',
    accentForeground: '#95d5b2',
    border: '#1e4a32',
    input: '#0f2e1e',
    ring: '#52b788',
    midground: '#52b788',
    composerRing: '#52b788',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0c1f15',
    sidebarBorder: '#1e4a32',
    userBubble: '#0f2e20',
    userBubbleBorder: '#1e5a3e',
  },
}

// ════════════════════════════════════════════════════════════
//  4. Sunset — 暖橙
// ════════════════════════════════════════════════════════════
export const sunsetTheme: DesktopTheme = {
  name: 'sunset',
  label: 'Sunset',
  description: '暖橙色调',
  colors: {
    background: '#1a0f0a',
    foreground: '#fef3eb',
    card: '#24160f',
    cardForeground: '#fef3eb',
    muted: '#2e1c14',
    mutedForeground: '#f4a261',
    popover: '#2e1c14',
    popoverForeground: '#fef3eb',
    primary: '#f4845f',
    primaryForeground: '#1a0f0a',
    secondary: '#341c10',
    secondaryForeground: '#f4a261',
    accent: 'rgba(244, 132, 95, 0.12)',
    accentForeground: '#f4a261',
    border: '#4a2818',
    input: '#341c10',
    ring: '#f4845f',
    midground: '#f4845f',
    composerRing: '#f4845f',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#1f120c',
    sidebarBorder: '#4a2818',
    userBubble: '#2e1c14',
    userBubbleBorder: '#5a3420',
  },
}

// ════════════════════════════════════════════════════════════
//  5. Midnight — 纯黑深色
// ════════════════════════════════════════════════════════════
export const midnightTheme: DesktopTheme = {
  name: 'midnight',
  label: 'Midnight',
  description: '纯黑深色',
  colors: {
    background: '#000000',
    foreground: '#e8e8e8',
    card: '#0a0a0a',
    cardForeground: '#e8e8e8',
    muted: '#141414',
    mutedForeground: '#888888',
    popover: '#111111',
    popoverForeground: '#e8e8e8',
    primary: '#818cf8',
    primaryForeground: '#000000',
    secondary: '#1a1a1a',
    secondaryForeground: '#c8c8c8',
    accent: 'rgba(129, 140, 248, 0.12)',
    accentForeground: '#c8c8f8',
    border: '#2a2a2a',
    input: '#1a1a1a',
    ring: '#818cf8',
    midground: '#818cf8',
    composerRing: '#818cf8',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#050505',
    sidebarBorder: '#222222',
    userBubble: '#0f0f0f',
    userBubbleBorder: '#2a2a2a',
  },
}

// ════════════════════════════════════════════════════════════
//  6. Rose — 粉红
// ════════════════════════════════════════════════════════════
export const roseTheme: DesktopTheme = {
  name: 'rose',
  label: 'Rose',
  description: '粉红色调',
  colors: {
    background: '#1a0a10',
    foreground: '#fde8f0',
    card: '#240f18',
    cardForeground: '#fde8f0',
    muted: '#2e1420',
    mutedForeground: '#f8a5c2',
    popover: '#2e1420',
    popoverForeground: '#fde8f0',
    primary: '#fb71a6',
    primaryForeground: '#1a0a10',
    secondary: '#34101e',
    secondaryForeground: '#f8a5c2',
    accent: 'rgba(251, 113, 166, 0.12)',
    accentForeground: '#f8a5c2',
    border: '#4a1830',
    input: '#34101e',
    ring: '#fb71a6',
    midground: '#fb71a6',
    composerRing: '#fb71a6',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#1f0c14',
    sidebarBorder: '#4a1830',
    userBubble: '#2e1420',
    userBubbleBorder: '#5a2040',
  },
}

// ════════════════════════════════════════════════════════════
//  7. Slate — 白灰
// ════════════════════════════════════════════════════════════
export const slateTheme: DesktopTheme = {
  name: 'slate',
  label: 'Slate',
  description: '白灰色调',
  colors: {
    background: '#f1f5f9',
    foreground: '#1e293b',
    card: '#f8fafc',
    cardForeground: '#1e293b',
    muted: '#e2e8f0',
    mutedForeground: '#64748b',
    popover: '#ffffff',
    popoverForeground: '#1e293b',
    primary: '#475569',
    primaryForeground: '#f8fafc',
    secondary: '#e2e8f0',
    secondaryForeground: '#334155',
    accent: 'rgba(71, 85, 105, 0.10)',
    accentForeground: '#334155',
    border: '#cbd5e1',
    input: '#e2e8f0',
    ring: '#475569',
    midground: '#475569',
    composerRing: '#475569',
    destructive: '#cf2d56',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#edf0f4',
    sidebarBorder: '#cbd5e1',
    userBubble: '#e8ecf1',
    userBubbleBorder: '#cbd5e1',
  },
}

// ════════════════════════════════════════════════════════════
//  导出
// ════════════════════════════════════════════════════════════

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  default: nousTheme,
  ocean: oceanTheme,
  forest: forestTheme,
  sunset: sunsetTheme,
  midnight: midnightTheme,
  rose: roseTheme,
  slate: slateTheme,
}

export const BUILTIN_THEME_LIST: DesktopTheme[] = [
  nousTheme,
  oceanTheme,
  forestTheme,
  sunsetTheme,
  midnightTheme,
  roseTheme,
  slateTheme,
]

/** 默认主题 */
export const DEFAULT_SKIN_NAME = 'default'
