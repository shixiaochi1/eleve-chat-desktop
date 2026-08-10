/**
 * 13 套主题定义
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
//  8. Violet — 紫罗兰
// ════════════════════════════════════════════════════════════
export const violetTheme: DesktopTheme = {
  name: 'violet',
  label: 'Violet',
  description: '紫罗兰深色',
  colors: {
    background: '#130a24',
    foreground: '#f0e6ff',
    card: '#1a0f30',
    cardForeground: '#f0e6ff',
    muted: '#221440',
    mutedForeground: '#b794f6',
    popover: '#1e1236',
    popoverForeground: '#f0e6ff',
    primary: '#8b5cf6',
    primaryForeground: '#130a24',
    secondary: '#261648',
    secondaryForeground: '#c4a8f8',
    accent: 'rgba(139, 92, 246, 0.12)',
    accentForeground: '#c4a8f8',
    border: '#3b2270',
    input: '#261648',
    ring: '#8b5cf6',
    midground: '#8b5cf6',
    composerRing: '#8b5cf6',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0f0818',
    sidebarBorder: '#3b2270',
    userBubble: '#1e1236',
    userBubbleBorder: '#4a2890',
  },
}

// ════════════════════════════════════════════════════════════
//  9. Cyan — 青蓝
// ════════════════════════════════════════════════════════════
export const cyanTheme: DesktopTheme = {
  name: 'cyan',
  label: 'Cyan',
  description: '青蓝深色',
  colors: {
    background: '#081a24',
    foreground: '#e0f7fa',
    card: '#0c2432',
    cardForeground: '#e0f7fa',
    muted: '#102e3e',
    mutedForeground: '#67e8f9',
    popover: '#102e3e',
    popoverForeground: '#e0f7fa',
    primary: '#22d3ee',
    primaryForeground: '#081a24',
    secondary: '#0e3040',
    secondaryForeground: '#a5f3fc',
    accent: 'rgba(34, 211, 238, 0.12)',
    accentForeground: '#a5f3fc',
    border: '#1a4a60',
    input: '#0e3040',
    ring: '#22d3ee',
    midground: '#22d3ee',
    composerRing: '#22d3ee',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#061420',
    sidebarBorder: '#1a4a60',
    userBubble: '#102e3e',
    userBubbleBorder: '#205a70',
  },
}

// ════════════════════════════════════════════════════════════
//  10. Amber — 琥珀金
// ════════════════════════════════════════════════════════════
export const amberTheme: DesktopTheme = {
  name: 'amber',
  label: 'Amber',
  description: '琥珀金深色',
  colors: {
    background: '#1c1408',
    foreground: '#fef6e0',
    card: '#261c0c',
    cardForeground: '#fef6e0',
    muted: '#322614',
    mutedForeground: '#fbbf24',
    popover: '#2e2010',
    popoverForeground: '#fef6e0',
    primary: '#f59e0b',
    primaryForeground: '#1c1408',
    secondary: '#3a2a12',
    secondaryForeground: '#fcd34d',
    accent: 'rgba(245, 158, 11, 0.12)',
    accentForeground: '#fcd34d',
    border: '#5a3e18',
    input: '#3a2a12',
    ring: '#f59e0b',
    midground: '#f59e0b',
    composerRing: '#f59e0b',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#161006',
    sidebarBorder: '#5a3e18',
    userBubble: '#2e2010',
    userBubbleBorder: '#6a4e24',
  },
}

// ════════════════════════════════════════════════════════════
//  11. Lavender — 薰衣草（浅色）
// ════════════════════════════════════════════════════════════
export const lavenderTheme: DesktopTheme = {
  name: 'lavender',
  label: 'Lavender',
  description: '薰衣草浅色',
  colors: {
    background: '#f5f0ff',
    foreground: '#1a1028',
    card: '#ffffff',
    cardForeground: '#1a1028',
    muted: 'color-mix(in srgb, #8b5cf6 5%, #ffffff)',
    mutedForeground: '#7c6a9e',
    popover: '#ffffff',
    popoverForeground: '#1a1028',
    primary: '#7c3aed',
    primaryForeground: '#fcfcfc',
    secondary: 'color-mix(in srgb, #8b5cf6 7%, #ffffff)',
    secondaryForeground: '#2e2040',
    accent: 'color-mix(in srgb, #8b5cf6 10%, #ffffff)',
    accentForeground: '#281838',
    border: 'color-mix(in srgb, #8b5cf6 20%, transparent)',
    input: 'color-mix(in srgb, #8b5cf6 28%, transparent)',
    ring: '#7c3aed',
    midground: '#7c3aed',
    composerRing: '#7c3aed',
    destructive: '#cf2d56',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#ede6f8',
    sidebarBorder: 'color-mix(in srgb, #8b5cf6 16%, transparent)',
    userBubble: 'color-mix(in srgb, #8b5cf6 5%, #ffffff)',
    userBubbleBorder: 'color-mix(in srgb, #8b5cf6 22%, transparent)',
  },
}

// ════════════════════════════════════════════════════════════
//  12. Graphite — 石墨灰（专业深色）
// ════════════════════════════════════════════════════════════
export const graphiteTheme: DesktopTheme = {
  name: 'graphite',
  label: 'Graphite',
  description: '石墨灰深色',
  colors: {
    background: '#18181b',
    foreground: '#e4e4e7',
    card: '#1e1e22',
    cardForeground: '#e4e4e7',
    muted: '#27272a',
    mutedForeground: '#a1a1aa',
    popover: '#202024',
    popoverForeground: '#e4e4e7',
    primary: '#a78bfa',
    primaryForeground: '#18181b',
    secondary: '#242428',
    secondaryForeground: '#d4d4d8',
    accent: 'rgba(167, 139, 250, 0.10)',
    accentForeground: '#c4b5fd',
    border: '#3f3f46',
    input: '#27272a',
    ring: '#a78bfa',
    midground: '#a78bfa',
    composerRing: '#a78bfa',
    destructive: '#e75e78',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#121216',
    sidebarBorder: '#3f3f46',
    userBubble: '#222226',
    userBubbleBorder: '#3f3f46',
  },
}

// ════════════════════════════════════════════════════════════
//  13. Nord — 北欧冷灰蓝
// ════════════════════════════════════════════════════════════
export const nordTheme: DesktopTheme = {
  name: 'nord',
  label: 'Nord',
  description: '北欧冷灰蓝',
  colors: {
    background: '#2e3440',
    foreground: '#eceff4',
    card: '#353b4a',
    cardForeground: '#eceff4',
    muted: '#3b4252',
    mutedForeground: '#d8dee9',
    popover: '#3b4252',
    popoverForeground: '#eceff4',
    primary: '#88c0d0',
    primaryForeground: '#2e3440',
    secondary: '#3b4252',
    secondaryForeground: '#d8dee9',
    accent: 'rgba(136, 192, 208, 0.12)',
    accentForeground: '#8fbcbb',
    border: '#434c5e',
    input: '#3b4252',
    ring: '#88c0d0',
    midground: '#88c0d0',
    composerRing: '#88c0d0',
    destructive: '#bf616a',
    destructiveForeground: '#eceff4',
    sidebarBackground: '#272d37',
    sidebarBorder: '#434c5e',
    userBubble: '#3b4252',
    userBubbleBorder: '#4c566a',
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
  violet: violetTheme,
  cyan: cyanTheme,
  amber: amberTheme,
  lavender: lavenderTheme,
  graphite: graphiteTheme,
  nord: nordTheme,
}

export const BUILTIN_THEME_LIST: DesktopTheme[] = [
  nousTheme,
  oceanTheme,
  forestTheme,
  sunsetTheme,
  midnightTheme,
  roseTheme,
  slateTheme,
  violetTheme,
  cyanTheme,
  amberTheme,
  lavenderTheme,
  graphiteTheme,
  nordTheme,
]

/** 默认主题 */
export const DEFAULT_SKIN_NAME = 'default'
