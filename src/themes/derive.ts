/**
 * macOS 风格颜色派生系统
 *
 * 核心原则：
 * - 只有 2 个用户可控参数：accent（主题色）+ appearance（外观模式）
 * - 所有颜色从这两个参数自动派生
 * - 明暗模式独立于主题色
 * - Light/Dark 语义色独立（macOS 标准）
 * - **所有灰色/中性色都从 accent 色相派生**，换色时整体系色联动
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

// ─── 预设主题色（macOS 标准） ───────────────────────────────────────────────

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

// 🔴 2026-08-13 老大指示：默认主题 = 灰色（Graphite 风格）——安装首次打开默认灰，
// 不抢眼；用户可在设置里换其它主题色（按钮/选中态跟主题走，无硬编码）
export const DEFAULT_ACCENT = '#8E8E93'
export const DEFAULT_APPEARANCE: Appearance = 'auto'

// ── 🔴 2026-08-18 老大需求：macOS 主题系统完善（System Settings 同级参数）──

/** 文字大小档位（macOS 显示器设置 → 文本大小；驱动 --dt-base-size） */
export type FontScale = 'small' | 'medium' | 'large'

/** 边栏色调：true = 边栏跟随主题色相（macOS「允许墙纸调色」的桌面等价物）；
 *  false = 中性灰边栏（色相固定冷蓝灰，换主题色边栏不动） */
export type SidebarTint = boolean

export const DEFAULT_SIDEBAR_TINT: SidebarTint = true
export const DEFAULT_REDUCE_TRANSPARENCY = false
export const DEFAULT_REDUCE_MOTION = false
export const DEFAULT_FONT_SCALE: FontScale = 'medium'

/** 各档位对应的根字号（html font-size = var(--dt-base-size；medium=1rem
 *  保持现状基线，small/large 按 ±12.5% 缩放——macOS 文字大小阶梯） */
export const FONT_SCALE_SIZES: Record<FontScale, string> = {
  small: '0.875rem',
  medium: '1rem',
  large: '1.125rem',
}

/** 中性边栏底色（sidebarTint=false 时覆盖 --theme-sidebar-background；
 *  色相固定 220 冷蓝灰，与 accent 解耦——macOS 无色调边栏语义） */
export function neutralSidebarFor(isDark: boolean): string {
  return isDark ? hsl(220, 7, 15) : hsl(220, 5, 94)
}

// ── 🔴 2026-08-18 终端 ANSI 色板主题化 ──────────────────────────────────────

/** 两色线性混合（t=0 → a，t=1 → b；xterm 终端色板派生用） */
export function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace('#', '')
  const pb = b.replace('#', '')
  const ar = parseInt(pa.slice(0, 2), 16)
  const ag = parseInt(pa.slice(2, 4), 16)
  const ab = parseInt(pa.slice(4, 6), 16)
  const br = parseInt(pb.slice(0, 2), 16)
  const bg = parseInt(pb.slice(2, 4), 16)
  const bb = parseInt(pb.slice(4, 6), 16)
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${toHex(ar + (br - ar) * t)}${toHex(ag + (bg - ag) * t)}${toHex(ab + (bb - ab) * t)}`
}

/** xterm ITheme 派生——终端 16 色 ANSI 色板全量主题化（🔴 2026-08-18 老大需求：
 *  UI 走主题控制不硬编码；原 useTerminal 写死 macOS 深色板，浅色模式不可用）：
 *  - 背景 = 卡片色（--ui-card-bg 同源，整卡统一；🔴 2026-08-18 修复：
 *    原深色模式用 colors.background 背板色 → 与右侧抽屉卡片割裂、不跟主题）
 *  - 前景/光标 = 主题派生色
 *  - 8 语义色（red/green/yellow/blue/magenta/cyan）= 主题语义色（Light/Dark 独立）
 *  - 灰阶（black/brightBlack/white/brightWhite）= 前景↔背板混合（中性灰阶基底）
 *  - bright* = 语义色向白混合 35%（标准「亮色 = 同色相更亮」约定） */
export function deriveTerminalTheme(colors: DerivedColors, isDark: boolean) {
  const brighten = (c: string) => mixHex(c, '#ffffff', 0.35)
  return {
    background: colors.card,
    foreground: colors.foreground,
    cursor: colors.primary,
    cursorAccent: colors.primaryForeground,
    selectionBackground: colors.selectionBackground,
    black: mixHex(colors.foreground, colors.background, 0.22),
    red: colors.semanticRed,
    green: colors.semanticGreen,
    yellow: colors.semanticYellow,
    blue: colors.semanticBlue,
    magenta: colors.semanticPurple,
    cyan: colors.semanticCyan,
    white: mixHex(colors.foreground, colors.background, 0.9),
    brightBlack: mixHex(colors.foreground, colors.background, 0.55),
    brightRed: brighten(colors.semanticRed),
    brightGreen: brighten(colors.semanticGreen),
    brightYellow: brighten(colors.semanticYellow),
    brightBlue: brighten(colors.semanticBlue),
    brightMagenta: brighten(colors.semanticPurple),
    brightCyan: brighten(colors.semanticCyan),
    brightWhite: colors.foreground,
  }
}

// ── 🔴 2026-08-18 自定义取色面板：hex ↔ HSL 互转（macOS 色板语言）──

/** hex → HSL（h 0..360 / s,l 0..100；2D 色场 + 色相条取色用） */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** HSL → hex（h 0..360 / s,l 0..100） */
export function hslToHex(h: number, s: number, l: number): string {
  return hsl(((h % 360) + 360) % 360, Math.min(100, Math.max(0, s)), Math.min(100, Math.max(0, l)))
}

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
 *
 * 架构铁律：所有中性色（背景/边框/阴影等）从 accent 色相派生，
 * 换色时整体系色联动。选蓝=冷蓝灰，选橙=暖橙灰。
 */
export function deriveColors(accent: string, isDark: boolean): DerivedColors {
  return isDark ? deriveDarkColors(accent) : deriveLightColors(accent)
}

/**
 * 浅色模式配色 —— 所有灰色从 accent 色相派生
 */
function deriveLightColors(accent: string): DerivedColors {
  const h = accentHue(accent)
  const semantic = SEMANTIC_COLORS.light

  // 基于 accent 色相生成中性色盘（极低饱和度 = 灰色带色调倾向）
  const neutral = {
    backboard:  hsl(h, 10, 92),  // 背板色（🔴 2026-08-13 联动增强：饱和度 6→10，主题色调更明显）
    sidebar:    hsl(h, 5,  94),  // 侧边栏（原 #EFEFF3）
    card:       hsl(h, 8,  100), // 卡片纯白
    chrome:     hsl(h, 4,  100), // chrome 层
    muted:      hsl(h, 4,  55),  // 次要文字（原 #86868B）
    fg:         hsl(h, 8,  12),  // 主文字（原 #1D1D1F）
  }

  return {
    // ── 背景层 ──
    background: neutral.backboard,
    foreground: neutral.fg,
    card: neutral.card,
    cardForeground: neutral.fg,
    popover: neutral.card,
    popoverForeground: neutral.fg,

    // ── 文字层次 ──
    muted: hexToRgba(neutral.fg, 0.04),
    mutedForeground: neutral.muted,

    // ── 主色 — 用户选的主题色（🔴 2026-08-13 降饱和 15%：选中态/主按钮实底不抢眼，色相不变）──
    primary: desaturate(accent, 0.85),
    // 🔴 2026-08-13 老大指示：主按钮文字/图标统一白色（getReadableOnAccent 对浅色
    // 主题色返回黑字 #1D1D1F，黑字突兀）——白字在任何主题色下视觉统一干净
    primaryForeground: '#FFFFFF',

    // ── 次级 — 主题色淡化 ──
    secondary: hexToRgba(accent, 0.12),
    secondaryForeground: accent,

    // ── 强调背景 — 更淡 ──
    accent: hexToRgba(accent, 0.08),
    accentForeground: accent,

    // ── 边框 — 带 accent 色相的半透明灰 ──
    border: hexToRgba(neutral.fg, 0.08),
    input:  hexToRgba(neutral.fg, 0.06),

    // ── 焦点环 — 主题色 ──
    ring: accent,
    midground: accent,
    composerRing: accent,

    // ── 危险色 ──
    destructive: semantic.red,
    destructiveForeground: '#FFFFFF',

    // ── 侧边栏 ──
    sidebarBackground: neutral.sidebar,
    sidebarBorder: hexToRgba(neutral.fg, 0.06),

    // ── 用户气泡 ──
    userBubble: hexToRgba(accent, 0.1),
    userBubbleBorder: hexToRgba(accent, 0.2),

    // ── 8 语义色 ──
    semanticRed: semantic.red,
    semanticOrange: semantic.orange,
    semanticYellow: semantic.yellow,
    semanticGreen: semantic.green,
    semanticCyan: semantic.cyan,
    semanticBlue: semantic.blue,
    semanticPurple: semantic.purple,
    semanticPink: semantic.pink,

    // ── 功能色 ──
    inputBackground: neutral.chrome,
    inlineCodeBackground: hexToRgba(neutral.fg, 0.05),
    inlineCodeBorder: hexToRgba(neutral.fg, 0.08),
    inlineCodeForeground: hexToRgba(neutral.fg, 0.88),
    selectionBackground: hexToRgba(accent, 0.3),
    warmAccent: adjustHue(accent, -15),

    // ── 阴影色 ──
    shadowColor: hexToRgba(hsl(h, 10, 15), 0.1),
    shadowColorHeavy: hexToRgba(hsl(h, 10, 15), 0.18),
    cardGlowCyan: hexToRgba(semantic.cyan, 0.5),
    cardGlowPurple: hexToRgba(semantic.purple, 0.5),

    // ── color-mix 系数 ──
    mixChrome: '4%',
    mixBackboard: '4%',
    mixSidebar: '4%',
    mixCard: '4%',
    mixElevated: '4%',
    mixBubble: '4%',
    neutralChrome: neutral.chrome,
    neutralSidebar: neutral.sidebar,
    neutralCard: neutral.card,

    // ── accent 混合百分比 ──
    fillPrimaryAccentMix: '10%',
    fillSecondaryAccentMix: '7%',
    fillTertiaryAccentMix: '5%',
    fillQuaternaryAccentMix: '4%',
    fillQuinaryAccentMix: '3%',
    strokePrimaryAccentMix: '10%',
    strokeSecondaryAccentMix: '7%',
    strokeTertiaryAccentMix: '5%',
    strokeQuaternaryAccentMix: '3%',
    rowHoverAccentMix: '3%',
    rowActiveAccentMix: '5%',
    controlHoverAccentMix: '4%',
    controlActiveAccentMix: '5%',
  }
}

/**
 * 深色模式配色 —— 所有灰色从 accent 色相派生
 */
function deriveDarkColors(accent: string): DerivedColors {
  const adjustedAccent = adjustBrightnessForDark(accent)
  const h = accentHue(adjustedAccent)
  const semantic = SEMANTIC_COLORS.dark

  // 基于 accent 色相生成暗色中性色盘
  const neutral = {
    backboard:  hsl(h, 14, 11),  // 背板（🔴 2026-08-13 联动增强：饱和度 8→14，主题色调更明显）
    sidebar:    hsl(h, 7,  15),  // 侧边栏（原 #242426）
    card:       hsl(h, 10, 18),  // 卡片（原 #2C2C2E）
    popover:    hsl(h, 12, 23),  // 弹出层（原 #3A3A3C）
    muted:      hsl(h, 5, 60),   // 次要文字（原 #98989D）
    fg:         hsl(h, 4, 96),   // 主文字（原 #F5F5F7）
  }

  return {
    // ── 背景层 ──
    background: neutral.backboard,
    foreground: neutral.fg,
    card: neutral.card,
    cardForeground: neutral.fg,
    popover: neutral.popover,
    popoverForeground: neutral.fg,

    // ── 文字层次 ──
    muted: hexToRgba(neutral.fg, 0.06),
    mutedForeground: neutral.muted,

    // ── 主色 ──（🔴 2026-08-13 降饱和 15%：与 light 同规则——选中态/主按钮实底收敛）
    primary: desaturate(adjustedAccent, 0.85),
    primaryForeground: neutral.backboard,

    // ── 次级 ──
    secondary: hexToRgba(adjustedAccent, 0.18),
    secondaryForeground: adjustedAccent,

    // ── 强调背景 ──
    accent: hexToRgba(adjustedAccent, 0.12),
    accentForeground: adjustedAccent,

    // ── 边框 ──
    border: hexToRgba(neutral.fg, 0.1),
    input:  hexToRgba(neutral.fg, 0.08),

    // ── 焦点环 ──
    ring: adjustedAccent,
    midground: adjustedAccent,
    composerRing: adjustedAccent,

    // ── 危险色 ──
    destructive: semantic.red,
    destructiveForeground: '#FFFFFF',

    // ── 侧边栏 ──
    sidebarBackground: neutral.sidebar,
    sidebarBorder: hexToRgba(neutral.fg, 0.08),

    // ── 用户气泡 ──
    userBubble: hexToRgba(adjustedAccent, 0.15),
    userBubbleBorder: hexToRgba(adjustedAccent, 0.25),

    // ── 8 语义色 ──
    semanticRed: semantic.red,
    semanticOrange: semantic.orange,
    semanticYellow: semantic.yellow,
    semanticGreen: semantic.green,
    semanticCyan: semantic.cyan,
    semanticBlue: semantic.blue,
    semanticPurple: semantic.purple,
    semanticPink: semantic.pink,

    // ── 功能色 ──
    inputBackground: neutral.card,
    inlineCodeBackground: hexToRgba(neutral.fg, 0.06),
    inlineCodeBorder: hexToRgba(neutral.fg, 0.1),
    inlineCodeForeground: hexToRgba(neutral.fg, 0.88),
    selectionBackground: hexToRgba(adjustedAccent, 0.35),
    warmAccent: adjustHue(adjustedAccent, -15),

    // ── 阴影色 ──
    shadowColor: hexToRgba(hsl(h, 10, 3), 0.3),
    shadowColorHeavy: hexToRgba(hsl(h, 10, 3), 0.45),
    cardGlowCyan: hexToRgba(semantic.cyan, 0.4),
    cardGlowPurple: hexToRgba(semantic.purple, 0.4),

    // ── color-mix 系数 ──
    mixChrome: '4%',
    mixBackboard: '4%',
    mixSidebar: '4%',
    mixCard: '4%',
    mixElevated: '4%',
    mixBubble: '4%',
    neutralChrome: neutral.card,
    neutralSidebar: neutral.sidebar,
    neutralCard: neutral.card,

    // ── accent 混合百分比 ──
    fillPrimaryAccentMix: '12%',
    fillSecondaryAccentMix: '8%',
    fillTertiaryAccentMix: '6%',
    fillQuaternaryAccentMix: '5%',
    fillQuinaryAccentMix: '4%',
    strokePrimaryAccentMix: '12%',
    strokeSecondaryAccentMix: '8%',
    strokeTertiaryAccentMix: '6%',
    strokeQuaternaryAccentMix: '4%',
    rowHoverAccentMix: '4%',
    rowActiveAccentMix: '6%',
    controlHoverAccentMix: '5%',
    controlActiveAccentMix: '6%',
  }
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

/** hex 转 rgba */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** HSL → hex（饱和度/明度 0–100） */
function hsl(h: number, s: number, l: number): string {
  const hs = s / 100
  const ls = l / 100
  const c = (1 - Math.abs(2 * ls - 1)) * hs
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = ls - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** 降低饱和度（factor 0–1，0.85 = 饱和度 ×0.85；用于 primary 实底色——
 *  选中态/主按钮实底收敛不抢眼，色相与亮度不变。🔴 2026-08-13 老大指示：
 *  桌面 UI 选中状态主题色降饱和 15%） */
function desaturate(hex: string, factor: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return hex // 无饱和（灰）→ 原样
  const d = max - min
  const l = (max + min) / 2
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return hsl(h, Math.max(0, s * factor) * 100, l * 100)
}

/** 提取 hex 的色相角度（0–360） */
function accentHue(hex: string): number {
  const clean = hex.replace('#', '')
  let r = parseInt(clean.slice(0, 2), 16) / 255
  let g = parseInt(clean.slice(2, 4), 16) / 255
  let b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 220 // 无饱和 → 默认冷蓝灰
  let h = 0
  if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / (max - min) + 2) * 60
  else h = ((r - g) / (max - min) + 4) * 60
  return h
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

/** WCAG 2.0 相对亮度（0–1，所有亮度判断的唯一真相源） */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 判断颜色是否为暗色（以相对亮度 0.5 为阈值） */
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) <= 0.5
}

/** 获取主题色上的可读文字颜色（🔴 2026-08-18 导出——ProjectDialogs 等
 *  硬编码 #1D1D1F/#FFFFFF 的调用方统一收敛到此处） */
export function getReadableOnAccent(accent: string): string {
  return isDarkColor(accent) ? '#FFFFFF' : '#1D1D1F'
}

/** 深色模式下调整主题色亮度：相对亮度低于 0.179（3:1 对比度底线）时调亮 */
export function adjustBrightnessForDark(hex: string): string {
  const clean = hex.replace('#', '')
  let r = parseInt(clean.slice(0, 2), 16)
  let g = parseInt(clean.slice(2, 4), 16)
  let b = parseInt(clean.slice(4, 6), 16)

  const luminance = relativeLuminance(hex)
  if (luminance < 0.179) {
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
  'default': { accent: '#8E8E93', appearance: 'light' },
  'midnight': { accent: '#AF52DE', appearance: 'dark' },
  'ember': { accent: '#FF9500', appearance: 'dark' },
  'mono': { accent: '#8E8E93', appearance: 'dark' },
  'cyberpunk': { accent: '#34C759', appearance: 'dark' },
  'slate': { accent: '#8E8E93', appearance: 'dark' },
  'glass': { accent: '#8E8E93', appearance: 'glass' },
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
