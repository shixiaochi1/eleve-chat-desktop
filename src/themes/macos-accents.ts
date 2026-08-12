/**
 * macOS 风格强调色系统
 * 
 * 用户只选1个强调色（accent color），系统自动派生完整配色。
 * 参考 macOS System Preferences > General > Accent color
 * 
 * 预设强调色（macOS标准）：
 * - 蓝色 #007AFF
 * - 紫色 #AF52DE
 * - 粉色 #FF2D55
 * - 红色 #FF3B30
 * - 橙色 #FF9500
 * - 黄色 #FFCC00
 * - 绿色 #34C759
 * - 石墨色 #8E8E93
 */

import type { DesktopThemeColors } from './types'

/** macOS 标准预设强调色 */
export const MACOS_ACCENT_COLORS = [
  { name: '蓝色', color: '#007AFF' },
  { name: '紫色', color: '#AF52DE' },
  { name: '粉色', color: '#FF2D55' },
  { name: '红色', color: '#FF3B30' },
  { name: '橙色', color: '#FF9500' },
  { name: '黄色', color: '#FFCC00' },
  { name: '绿色', color: '#34C759' },
  { name: '石墨色', color: '#8E8E93' },
] as const

/** 默认强调色 */
export const DEFAULT_MACOS_ACCENT = '#007AFF'

/**
 * 根据强调色 + 明暗模式，派生完整配色
 * 参考 macOS HIG (Human Interface Guidelines) 的颜色系统
 */
export function deriveMacOSThemeColors(accent: string, isDark: boolean): DesktopThemeColors {
  if (isDark) {
    return deriveDarkColors(accent)
  }
  return deriveLightColors(accent)
}

/** 浅色模式配色派生 */
function deriveLightColors(accent: string): DesktopThemeColors {
  return {
    // 背景层 — 白色系
    background: '#F5F5F7',
    foreground: '#1D1D1F',
    card: '#FFFFFF',
    cardForeground: '#1D1D1F',
    popover: '#FFFFFF',
    popoverForeground: '#1D1D1F',
    
    // 文字层次
    muted: 'rgba(0, 0, 0, 0.04)',
    mutedForeground: '#86868B',
    
    // 主色 — 用户选的强调色
    primary: accent,
    primaryForeground: getReadableOnAccent(accent),
    
    // 次级 — 强调色淡化
    secondary: hexToRgba(accent, 0.12),
    secondaryForeground: accent,
    
    // 强调背景 — 更淡
    accent: hexToRgba(accent, 0.08),
    accentForeground: accent,
    
    // 边框 — 黑色低透明度
    border: 'rgba(0, 0, 0, 0.08)',
    input: 'rgba(0, 0, 0, 0.06)',
    
    // 焦点环 — 强调色
    ring: accent,
    midground: accent,
    composerRing: accent,
    
    // 危险色 — macOS 标准红
    destructive: '#FF3B30',
    destructiveForeground: '#FFFFFF',
    
    // 侧边栏 — 略深于背景
    sidebarBackground: '#EFEFF3',
    sidebarBorder: 'rgba(0, 0, 0, 0.06)',
    
    // 用户气泡 — 强调色淡化
    userBubble: hexToRgba(accent, 0.1),
    userBubbleBorder: hexToRgba(accent, 0.2),
  }
}

/** 深色模式配色派生 */
function deriveDarkColors(accent: string): DesktopThemeColors {
  // 深色模式下强调色需要稍微调亮，保证可读性
  const adjustedAccent = adjustBrightnessForDark(accent)
  
  return {
    // 背景层 — 深灰系
    background: '#1C1C1E',
    foreground: '#F5F5F7',
    card: '#2C2C2E',
    cardForeground: '#F5F5F7',
    popover: '#3A3A3C',
    popoverForeground: '#F5F5F7',
    
    // 文字层次
    muted: 'rgba(255, 255, 255, 0.06)',
    mutedForeground: '#98989D',
    
    // 主色 — 调整后的强调色
    primary: adjustedAccent,
    primaryForeground: '#1C1C1E',
    
    // 次级 — 强调色淡化
    secondary: hexToRgba(adjustedAccent, 0.18),
    secondaryForeground: adjustedAccent,
    
    // 强调背景 — 更淡
    accent: hexToRgba(adjustedAccent, 0.12),
    accentForeground: adjustedAccent,
    
    // 边框 — 白色低透明度
    border: 'rgba(255, 255, 255, 0.1)',
    input: 'rgba(255, 255, 255, 0.08)',
    
    // 焦点环 — 强调色
    ring: adjustedAccent,
    midground: adjustedAccent,
    composerRing: adjustedAccent,
    
    // 危险色 — macOS 标准红（深色模式调亮）
    destructive: '#FF453A',
    destructiveForeground: '#FFFFFF',
    
    // 侧边栏 — 略深于背景
    sidebarBackground: '#242426',
    sidebarBorder: 'rgba(255, 255, 255, 0.08)',
    
    // 用户气泡 — 强调色淡化
    userBubble: hexToRgba(adjustedAccent, 0.15),
    userBubbleBorder: hexToRgba(adjustedAccent, 0.25),
  }
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

/** hex 转 rgba */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 判断颜色是否为暗色 */
function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  // 相对亮度公式
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.5
}

/** 获取强调色上的可读文字颜色 */
function getReadableOnAccent(accent: string): string {
  return isDarkColor(accent) ? '#FFFFFF' : '#1D1D1F'
}

/** 深色模式下调整强调色亮度 */
function adjustBrightnessForDark(hex: string): string {
  const clean = hex.replace('#', '')
  let r = parseInt(clean.slice(0, 2), 16)
  let g = parseInt(clean.slice(2, 4), 16)
  let b = parseInt(clean.slice(4, 6), 16)
  
  // 如果颜色太暗，调亮一些
  const brightness = (r + g + b) / 3
  if (brightness < 100) {
    const factor = 1.4
    r = Math.min(255, Math.round(r * factor))
    g = Math.min(255, Math.round(g * factor))
    b = Math.min(255, Math.round(b * factor))
  }
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
