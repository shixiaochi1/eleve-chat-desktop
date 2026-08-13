/**
 * macOS 风格颜色派生系统
 * 
 * 核心原则：
 * - 只有 2 个用户可控参数：accent（强调色）+ appearance（外观模式）
 * - 所有颜色从这两个参数自动派生
 * - 明暗模式独立于强调色
 * - Light/Dark 语义色独立（macOS 标准）
 */

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export type Appearance = 'light' | 'dark' | 'auto' | 'glass'

export interface DerivedColors {
  // ── 背景层 ──
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  
  // ── 文字层 ──
  muted: string
  mutedForeground: string
  
  // ── 主色层 ──
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string
  
  // ── 边框层 ──
  border: string
  input: string
  ring: string
  midground: string
  composerRing: string
  
  // ── 语义层 ──
  destructive: string
  destructiveForeground: string
  
  // ── 侧边栏 ──
  sidebarBackground: string
  sidebarBorder: string
  
  // ── 气泡 ──
  userBubble: string
  userBubbleBorder: string

  // ── ★ 新增：8 语义色（macOS 标准，Light/Dark 独立值）──
  semanticRed: string
  semanticOrange: string
  semanticYellow: string
  semanticGreen: string
  semanticCyan: string
  semanticBlue: string
  semanticPurple: string
  semanticPink: string

  // ── ★ 新增：功能色 ──
  inputBackground: string
  inlineCodeBackground: string
  inlineCodeBorder: string
  inlineCodeForeground: string
  selectionBackground: string
  warmAccent: string

  // ── ★ 新增：阴影色 ──
  shadowColor: string
  shadowColorHeavy: string
  cardGlowCyan: string
  cardGlowPurple: string

  // ── ★ 新增：color-mix 系数（替代断裂的种子变量）──
  mixChrome: string
  mixBackboard: string
  mixSidebar: string
  mixCard: string
  mixElevated: string
  mixBubble: string
  neutralChrome: string
  neutralSidebar: string
  neutralCard: string

  // ── ★ 新增：accent 混合百分比（fill/stroke/row/control 层级）──
  fillPrimaryAccentMix: string
  fillSecondaryAccentMix: string
  fillTertiaryAccentMix: string
  fillQuaternaryAccentMix: string
  fillQuinaryAccentMix: string
  strokePrimaryAccentMix: string
  strokeSecondaryAccentMix: string
  strokeTertiaryAccentMix: string
  strokeQuaternaryAccentMix: string
  rowHoverAccentMix: string
  rowActiveAccentMix: string
  controlHoverAccentMix: string
  controlActiveAccentMix: string
}

// ─── 预设强调色（macOS 标准） ───────────────────────────────────────────────

export const ACCENT_COLORS = [
  { name: '蓝色', color: '#007AFF' },
  { name: '紫色', color: '#AF52DE' },
  { name: '粉色', color: '#FF2D55' },
  { name: '红色', color: '#FF3B30' },
  { name: '橙色', color: '#FF9500' },
  { name: '黄色', color: '#FFCC00' },
  { name: '绿色', color: '#34C759' },
  { name: '石墨色', color: '#8E8E93' },
] as const

export const DEFAULT_ACCENT = '#007AFF'
export const DEFAULT_APPEARANCE: Appearance = 'auto'

// ─── macOS 标准语义色 ───────────────────────────────────────────────────────

const SEMANTIC_COLORS = {
  light: {
    red: '#FF3B30',
    orange: '#FF9500',
    yellow: '#FFCC00',
    green: '#34C759',
    cyan: '#5AC8FA',
    blue: '#007AFF',
    purple: '#AF52DE',
    pink: '#FF2D55',
  },
  dark: {
    red: '#FF453A',
    orange: '#FF9F0A',
    yellow: '#FFD60A',
    green: '#30D158',
    cyan: '#64D2FF',
    blue: '#0A84FF',
    purple: '#BF5AF2',
    pink: '#FF375F',
  },
}

// ─── 核心派生逻辑 ───────────────────────────────────────────────────────────

/**
 * 从 accent + isDark 派生完整配色
 */
export function deriveColors(accent: string, isDark: boolean): DerivedColors {
  return isDark ? deriveDarkColors(accent) : deriveLightColors(accent)
}

/**
 * 浅色模式配色
 */
function deriveLightColors(accent: string): DerivedColors {
  const semantic = SEMANTIC_COLORS.light
  return {
    // ── 背景层 — 中性灰（背板）──
    background: '#E8E8ED',
    foreground: '#1D1D1F',
    // ── 卡片层 — 纯白（3张功能卡片）──
    card: '#FFFFFF',
    cardForeground: '#1D1D1F',
    popover: '#FFFFFF',
    popoverForeground: '#1D1D1F',
    
    // ── 文字层次 ──
    muted: 'rgba(0, 0, 0, 0.04)',
    mutedForeground: '#86868B',
    
    // ── 主色 — 用户选的强调色 ──
    primary: accent,
    primaryForeground: getReadableOnAccent(accent),
    
    // ── 次级 — 强调色淡化 ──
    secondary: hexToRgba(accent, 0.12),
    secondaryForeground: accent,
    
    // ── 强调背景 — 更淡 ──
    accent: hexToRgba(accent, 0.08),
    accentForeground: accent,
    
    // ── 边框 — 黑色低透明度 ──
    border: 'rgba(0, 0, 0, 0.08)',
    input: 'rgba(0, 0, 0, 0.06)',
    
    // ── 焦点环 — 强调色 ──
    ring: accent,
    midground: accent,
    composerRing: accent,
    
    // ── 危险色 — macOS 标准红 ──
    destructive: semantic.red,
    destructiveForeground: '#FFFFFF',
    
    // ── 侧边栏 — 略深于背景 ──
    sidebarBackground: '#EFEFF3',
    sidebarBorder: 'rgba(0, 0, 0, 0.06)',
    
    // ── 用户气泡 — 强调色淡化 ──
    userBubble: hexToRgba(accent, 0.1),
    userBubbleBorder: hexToRgba(accent, 0.2),

    // ── 8 语义色（macOS 标准）──
    semanticRed: semantic.red,
    semanticOrange: semantic.orange,
    semanticYellow: semantic.yellow,
    semanticGreen: semantic.green,
    semanticCyan: semantic.cyan,
    semanticBlue: semantic.blue,
    semanticPurple: semantic.purple,
    semanticPink: semantic.pink,

    // ── 功能色 ──
    inputBackground: '#FCFCFC',
    inlineCodeBackground: 'rgba(0, 0, 0, 0.05)',
    inlineCodeBorder: 'rgba(0, 0, 0, 0.08)',
    inlineCodeForeground: 'rgba(0, 0, 0, 0.88)',
    selectionBackground: 'rgba(0, 122, 255, 0.3)',
    warmAccent: adjustHue(accent, -15),

    // ── 阴影色 ──
    shadowColor: 'rgba(0, 0, 0, 0.1)',
    shadowColorHeavy: 'rgba(0, 0, 0, 0.18)',
    cardGlowCyan: hexToRgba(semantic.cyan, 0.5),
    cardGlowPurple: hexToRgba(semantic.purple, 0.5),

    // ── color-mix 系数 ──
    mixChrome: '4%',
    mixBackboard: '4%',
    mixSidebar: '4%',
    mixCard: '4%',
    mixElevated: '4%',
    mixBubble: '4%',
    neutralChrome: '#FFFFFF',
    neutralSidebar: '#EFEFF3',
    neutralCard: '#FFFFFF',

    // ── accent 混合百分比（fill 层级：越往下越淡）──
    fillPrimaryAccentMix: '10%',
    fillSecondaryAccentMix: '7%',
    fillTertiaryAccentMix: '5%',
    fillQuaternaryAccentMix: '4%',
    fillQuinaryAccentMix: '3%',

    // ── accent 混合百分比（stroke 层级）──
    strokePrimaryAccentMix: '10%',
    strokeSecondaryAccentMix: '7%',
    strokeTertiaryAccentMix: '5%',
    strokeQuaternaryAccentMix: '3%',

    // ── accent 混合百分比（row 层级）──
    rowHoverAccentMix: '3%',
    rowActiveAccentMix: '5%',

    // ── accent 混合百分比（control 层级）──
    controlHoverAccentMix: '4%',
    controlActiveAccentMix: '5%',
  }
}

/**
 * 深色模式配色
 */
function deriveDarkColors(accent: string): DerivedColors {
  const adjustedAccent = adjustBrightnessForDark(accent)
  const semantic = SEMANTIC_COLORS.dark
  
  return {
    // ── 背景层 — 深灰（背板）──
    background: '#1C1C1E',
    foreground: '#F5F5F7',
    // ── 卡片层 — 中灰（3张功能卡片，比背板亮）──
    card: '#2C2C2E',
    cardForeground: '#F5F5F7',
    popover: '#3A3A3C',
    popoverForeground: '#F5F5F7',
    
    // ── 文字层次 ──
    muted: 'rgba(255, 255, 255, 0.06)',
    mutedForeground: '#98989D',
    
    // ── 主色 — 调整后的强调色 ──
    primary: adjustedAccent,
    primaryForeground: '#1C1C1E',
    
    // ── 次级 — 强调色淡化 ──
    secondary: hexToRgba(adjustedAccent, 0.18),
    secondaryForeground: adjustedAccent,
    
    // ── 强调背景 — 更淡 ──
    accent: hexToRgba(adjustedAccent, 0.12),
    accentForeground: adjustedAccent,
    
    // ── 边框 — 白色低透明度 ──
    border: 'rgba(255, 255, 255, 0.1)',
    input: 'rgba(255, 255, 255, 0.08)',
    
    // ── 焦点环 — 强调色 ──
    ring: adjustedAccent,
    midground: adjustedAccent,
    composerRing: adjustedAccent,
    
    // ── 危险色 — macOS 标准红（深色模式调亮）──
    destructive: semantic.red,
    destructiveForeground: '#FFFFFF',
    
    // ── 侧边栏 — 略深于背景 ──
    sidebarBackground: '#242426',
    sidebarBorder: 'rgba(255, 255, 255, 0.08)',
    
    // ── 用户气泡 — 强调色淡化 ──
    userBubble: hexToRgba(adjustedAccent, 0.15),
    userBubbleBorder: hexToRgba(adjustedAccent, 0.25),

    // ── 8 语义色（macOS 标准，Dark 模式调亮）──
    semanticRed: semantic.red,
    semanticOrange: semantic.orange,
    semanticYellow: semantic.yellow,
    semanticGreen: semantic.green,
    semanticCyan: semantic.cyan,
    semanticBlue: semantic.blue,
    semanticPurple: semantic.purple,
    semanticPink: semantic.pink,

    // ── 功能色（暗色模式适配）──
    inputBackground: '#2C2C2E',
    inlineCodeBackground: 'rgba(255, 255, 255, 0.06)',
    inlineCodeBorder: 'rgba(255, 255, 255, 0.1)',
    inlineCodeForeground: 'rgba(255, 255, 255, 0.88)',
    selectionBackground: 'rgba(10, 132, 255, 0.35)',
    warmAccent: adjustHue(adjustedAccent, -15),

    // ── 阴影色（暗色模式使用 lighter shadow）──
    shadowColor: 'rgba(0, 0, 0, 0.3)',
    shadowColorHeavy: 'rgba(0, 0, 0, 0.45)',
    cardGlowCyan: hexToRgba(semantic.cyan, 0.4),
    cardGlowPurple: hexToRgba(semantic.purple, 0.4),

    // ── color-mix 系数（暗色模式中性色调整）──
    mixChrome: '4%',
    mixBackboard: '4%',
    mixSidebar: '4%',
    mixCard: '4%',
    mixElevated: '4%',
    mixBubble: '4%',
    neutralChrome: '#2C2C2E',
    neutralSidebar: '#242426',
    neutralCard: '#2C2C2E',

    // ── accent 混合百分比（暗色模式微调）──
    fillPrimaryAccentMix: '12%',
    fillSecondaryAccentMix: '8%',
    fillTertiaryAccentMix: '6%',
    fillQuaternaryAccentMix: '5%',
    fillQuinaryAccentMix: '4%',

    // ── accent 混合百分比（stroke 层级）──
    strokePrimaryAccentMix: '12%',
    strokeSecondaryAccentMix: '8%',
    strokeTertiaryAccentMix: '6%',
    strokeQuaternaryAccentMix: '4%',

    // ── accent 混合百分比（row 层级）──
    rowHoverAccentMix: '4%',
    rowActiveAccentMix: '6%',

    // ── accent 混合百分比（control 层级）──
    controlHoverAccentMix: '5%',
    controlActiveAccentMix: '6%',
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

/** 色相偏移（用于 warmAccent 等派生） */
function adjustHue(hex: string, degrees: number): string {
  const clean = hex.replace('#', '')
  let r = parseInt(clean.slice(0, 2), 16) / 255
  let g = parseInt(clean.slice(2, 4), 16) / 255
  let b = parseInt(clean.slice(4, 6), 16) / 255

  // RGB → HSL
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min))

  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / (max - min) + 2) / 6
    else h = ((r - g) / (max - min) + 4) / 6
  }

  // 偏移色相
  h = (h + degrees / 360 + 1) % 1

  // HSL → RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  r = hue2rgb(p, q, h + 1 / 3)
  g = hue2rgb(p, q, h)
  b = hue2rgb(p, q, h - 1 / 3)

  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ─── 迁移工具 ───────────────────────────────────────────────────────────────

/**
 * 旧 skin 名称 → 新 accent + appearance 映射
 */
const SKIN_MIGRATION_MAP: Record<string, { accent: string; appearance: Appearance }> = {
  'default': { accent: '#007AFF', appearance: 'light' },
  'midnight': { accent: '#AF52DE', appearance: 'dark' },
  'ember': { accent: '#FF9500', appearance: 'dark' },
  'mono': { accent: '#8E8E93', appearance: 'dark' },
  'cyberpunk': { accent: '#34C759', appearance: 'dark' },
  'slate': { accent: '#007AFF', appearance: 'dark' },
  'glass': { accent: '#007AFF', appearance: 'glass' },
  'silver': { accent: '#8E8E93', appearance: 'light' },
  'graphite': { accent: '#8E8E93', appearance: 'dark' },
  'charcoal': { accent: '#8E8E93', appearance: 'dark' },
}

/**
 * 迁移旧 skin 配置到新格式
 */
export function migrateSkinConfig(skin: string): { accent: string; appearance: Appearance } {
  return SKIN_MIGRATION_MAP[skin] ?? { accent: DEFAULT_ACCENT, appearance: DEFAULT_APPEARANCE }
}
