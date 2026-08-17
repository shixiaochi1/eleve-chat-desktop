/**
 * 主题上下文 — macOS 风格
 * 
 * 核心设计：
 * - 只有 2 个用户可控参数：accent（主题色）+ appearance（外观模式）
 * - 所有颜色从这两个参数自动派生
 * - 明暗模式独立于主题色
 * 
 * 持久化：
 * - localStorage + Tauri storage 双写（即时缓存）
 * - 后端 config.yaml 同步（持久化真相源）
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as storage from '../utils/storage'
import { call } from '../utils/bridge'
import {
  deriveColors,
  ACCENT_COLORS,
  DEFAULT_ACCENT,
  DEFAULT_APPEARANCE,
  DEFAULT_SIDEBAR_TINT,
  DEFAULT_REDUCE_TRANSPARENCY,
  DEFAULT_REDUCE_MOTION,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_SIZES,
  neutralSidebarFor,
  hexToRgba,
  parseAccentGradient,
  serializeAccentGradient,
  gradientMidColor,
  type Appearance,
  type DerivedColors,
  type FontScale,
  type SidebarTint,
  type AccentGradient,
} from './derive'

const ACCENT_KEY = 'eleve-accent-color'
const APPEARANCE_KEY = 'eleve-appearance'
// 🔴 2026-08-18 老大需求：macOS 主题系统完善——新增 4 个持久化项
const SIDEBAR_TINT_KEY = 'eleve-sidebar-tint'
const REDUCE_TRANSPARENCY_KEY = 'eleve-reduce-transparency'
const REDUCE_MOTION_KEY = 'eleve-reduce-motion'
const FONT_SCALE_KEY = 'eleve-font-scale'

import { emit } from '@tauri-apps/api/event';

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}

function isDarkColor(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  const [r, g, b] = rgb.map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.5
}

// ─── 持久化 ─────────────────────────────────────────────────────────────────

/** 🔴 2026-08-18 主题色 = 多锚点渐变：存储 JSON 数组（兼容旧单 hex） */
function loadAccentGradient(): AccentGradient {
  const local = localStorage.getItem(ACCENT_KEY)
  if (local !== null) return parseAccentGradient(local)
  const saved = storage.load(ACCENT_KEY) as string | null
  return parseAccentGradient(saved)
}

function saveAccentGradient(stops: AccentGradient): void {
  const value = serializeAccentGradient(stops)
  localStorage.setItem(ACCENT_KEY, value)
  storage.save(ACCENT_KEY, value)
}

/** 兼容旧读取（单 hex；供启动回填/看板窗口等使用） */
function loadAccent(): string {
  return gradientMidColor(loadAccentGradient())
}

function saveAccent(color: string): void {
  saveAccentGradient(parseAccentGradient(color))
}

function loadAppearance(): Appearance {
  const local = localStorage.getItem(APPEARANCE_KEY) as Appearance | null
  if (local) return local
  const saved = storage.load(APPEARANCE_KEY) as Appearance | null
  return saved ?? DEFAULT_APPEARANCE
}

function saveAppearance(appearance: Appearance): void {
  localStorage.setItem(APPEARANCE_KEY, appearance)
  storage.save(APPEARANCE_KEY, appearance)
}

// ── 🔴 2026-08-18 新增设置读写（localStorage 即时缓存 + storage 落盘）──

function loadSidebarTint(): SidebarTint {
  const v = localStorage.getItem(SIDEBAR_TINT_KEY)
  if (v !== null) return v === '1'
  const saved = storage.load(SIDEBAR_TINT_KEY) as boolean | null
  return saved ?? DEFAULT_SIDEBAR_TINT
}

function saveSidebarTint(v: SidebarTint): void {
  localStorage.setItem(SIDEBAR_TINT_KEY, v ? '1' : '0')
  storage.save(SIDEBAR_TINT_KEY, v)
}

function loadReduceTransparency(): boolean {
  const v = localStorage.getItem(REDUCE_TRANSPARENCY_KEY)
  if (v !== null) return v === '1'
  const saved = storage.load(REDUCE_TRANSPARENCY_KEY) as boolean | null
  return saved ?? DEFAULT_REDUCE_TRANSPARENCY
}

function saveReduceTransparency(v: boolean): void {
  localStorage.setItem(REDUCE_TRANSPARENCY_KEY, v ? '1' : '0')
  storage.save(REDUCE_TRANSPARENCY_KEY, v)
}

function loadReduceMotion(): boolean {
  const v = localStorage.getItem(REDUCE_MOTION_KEY)
  if (v !== null) return v === '1'
  const saved = storage.load(REDUCE_MOTION_KEY) as boolean | null
  return saved ?? DEFAULT_REDUCE_MOTION
}

function saveReduceMotion(v: boolean): void {
  localStorage.setItem(REDUCE_MOTION_KEY, v ? '1' : '0')
  storage.save(REDUCE_MOTION_KEY, v)
}

function loadFontScale(): FontScale {
  const v = localStorage.getItem(FONT_SCALE_KEY) as FontScale | null
  if (v === 'small' || v === 'medium' || v === 'large') return v
  const saved = storage.load(FONT_SCALE_KEY) as FontScale | null
  return saved === 'small' || saved === 'large' ? saved : DEFAULT_FONT_SCALE
}

function saveFontScale(v: FontScale): void {
  localStorage.setItem(FONT_SCALE_KEY, v)
  storage.save(FONT_SCALE_KEY, v)
}

// ─── 系统明暗检测 ───────────────────────────────────────────────────────────

function getSystemDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ─── CSS 注入 ───────────────────────────────────────────────────────────────

export interface ThemeAppearanceOptions {
  /** 边栏色调（false = 中性灰边栏，不跟随主题色相） */
  sidebarTint?: SidebarTint
  /** 降低透明度（关闭全部 backdrop-filter 玻璃效果） */
  reduceTransparency?: boolean
  /** 减弱动态效果（禁用动画/过渡，对齐系统 prefers-reduced-motion） */
  reduceMotion?: boolean
  /** 文字大小档位（驱动 --dt-base-size 根字号） */
  fontScale?: FontScale
}

export function applyThemeCSS(
  colors: DerivedColors,
  isDark: boolean,
  isGlass: boolean,
  rawAccent: string,
  options: ThemeAppearanceOptions = {},
) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const { sidebarTint = true, reduceTransparency = false, reduceMotion = false, fontScale = 'medium' } = options

  // 1. Dark class + color-scheme
  root.classList.toggle('dark', isDark)
  root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')
  root.dataset.eleveTheme = isGlass ? 'glass' : (isDark ? 'dark' : 'light')
  root.dataset.eleveMode = isDark ? 'dark' : 'light'

  // 2. 注入所有派生颜色（完整链路：--theme-* → --dt-* → --ui-*）
  const vars: Record<string, string> = {
    // ── 背景层 ──
    '--theme-background': colors.background,
    '--theme-foreground': colors.foreground,
    '--theme-card': colors.card,
    '--theme-card-foreground': colors.cardForeground,
    '--theme-popover': colors.popover,
    '--theme-popover-foreground': colors.popoverForeground,
    
    // ── 文字层 ──
    '--theme-muted': colors.muted,
    '--theme-muted-foreground': colors.mutedForeground,
    
    // ── 主色层 ──
    '--theme-primary': colors.primary,
    '--theme-primary-foreground': colors.primaryForeground,
    '--theme-secondary': colors.secondary,
    '--theme-secondary-foreground': colors.secondaryForeground,
    '--theme-accent': colors.accent,
    '--theme-accent-foreground': colors.accentForeground,
    
    // ── 边框层 ──
    '--theme-border': colors.border,
    '--theme-input': colors.input,
    '--theme-ring': colors.ring,
    '--theme-midground': colors.midground,
    '--theme-composer-ring': colors.composerRing,
    
    // ── 语义层 ──
    '--theme-destructive': colors.destructive,
    '--theme-destructive-foreground': colors.destructiveForeground,
    
    // ── 侧边栏 ──
    '--theme-sidebar-background': colors.sidebarBackground,
    '--theme-sidebar-border': colors.sidebarBorder,
    
    // ── 气泡 ──
    '--theme-user-bubble': colors.userBubble,
    '--theme-user-bubble-border': colors.userBubbleBorder,

    // ── ★ 新增：8 语义色（macOS 标准）──
    '--theme-semantic-red': colors.semanticRed,
    '--theme-semantic-orange': colors.semanticOrange,
    '--theme-semantic-yellow': colors.semanticYellow,
    '--theme-semantic-green': colors.semanticGreen,
    '--theme-semantic-cyan': colors.semanticCyan,
    '--theme-semantic-blue': colors.semanticBlue,
    '--theme-semantic-purple': colors.semanticPurple,
    '--theme-semantic-pink': colors.semanticPink,

    // ── ★ 新增：功能色 ──
    '--theme-input-background': colors.inputBackground,
    '--theme-inline-code-background': colors.inlineCodeBackground,
    '--theme-inline-code-border': colors.inlineCodeBorder,
    '--theme-inline-code-foreground': colors.inlineCodeForeground,
    '--theme-selection-background': colors.selectionBackground,
    '--theme-warm-accent': colors.warmAccent,

    // ── ★ 新增：阴影色 ──
    '--theme-shadow-color': colors.shadowColor,
    '--theme-shadow-color-heavy': colors.shadowColorHeavy,
    '--theme-card-glow-cyan': colors.cardGlowCyan,
    '--theme-card-glow-purple': colors.cardGlowPurple,

    // ── ★ 新增：color-mix 系数（替代断裂的种子变量）──
    '--theme-mix-chrome': colors.mixChrome,
    '--theme-mix-backboard': colors.mixBackboard,
    '--theme-mix-sidebar': colors.mixSidebar,
    '--theme-mix-card': colors.mixCard,
    '--theme-mix-elevated': colors.mixElevated,
    '--theme-mix-bubble': colors.mixBubble,
    '--theme-neutral-chrome': colors.neutralChrome,
    '--theme-neutral-sidebar': colors.neutralSidebar,
    '--theme-neutral-card': colors.neutralCard,

    // ── ★ 新增：accent 混合百分比 ──
    '--theme-fill-primary-accent-mix': colors.fillPrimaryAccentMix,
    '--theme-fill-secondary-accent-mix': colors.fillSecondaryAccentMix,
    '--theme-fill-tertiary-accent-mix': colors.fillTertiaryAccentMix,
    '--theme-fill-quaternary-accent-mix': colors.fillQuaternaryAccentMix,
    '--theme-fill-quinary-accent-mix': colors.fillQuinaryAccentMix,
    '--theme-stroke-primary-accent-mix': colors.strokePrimaryAccentMix,
    '--theme-stroke-secondary-accent-mix': colors.strokeSecondaryAccentMix,
    '--theme-stroke-tertiary-accent-mix': colors.strokeTertiaryAccentMix,
    '--theme-stroke-quaternary-accent-mix': colors.strokeQuaternaryAccentMix,
    '--theme-row-hover-accent-mix': colors.rowHoverAccentMix,
    '--theme-row-active-accent-mix': colors.rowActiveAccentMix,
    '--theme-control-hover-accent-mix': colors.controlHoverAccentMix,
    '--theme-control-active-accent-mix': colors.controlActiveAccentMix,
  }

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }

  // 3. Glass 模式特殊处理：用 color-mix 把主题色融入玻璃底色
  // 🔴 2026-08-13 修复 v2：半透明主题色（35% alpha）混入——
  //   v1 用实色（alpha=1）→ body 渐变不透明 → 盖住 Mica 窗口效果 → 玻璃消失；
  //   原版用 colors.accent（8% alpha）→ 保留玻璃但色相几乎不可见（联动≈0）。
  //   35% alpha 折中：玻璃半透明保留（Mica 透出）+ 主题色联动可见（≈2.5 倍）
  if (isGlass) {
    root.classList.add('glass-mode')
    const accentMix = hexToRgba(rawAccent, 0.20)
    const bg = isDark ? 'rgb(18,18,20)' : 'rgb(232,232,237)'
    root.style.setProperty('--glass-body-top', `color-mix(in srgb, ${bg} 88%, ${accentMix})`)
    root.style.setProperty('--glass-body-bottom', `color-mix(in srgb, ${bg} 76%, ${accentMix})`)
    // 子组件玻璃色也跟随主题色（同样半透明，防盖 Mica）
    const chromeAlpha = isDark ? 'rgba(18,18,20,0.88)' : 'rgba(232,232,237,0.92)'
    root.style.setProperty('--glass-bg-chrome', `color-mix(in srgb, ${chromeAlpha} 70%, ${accentMix})`)
    root.style.setProperty('--glass-bg-sidebar', `color-mix(in srgb, ${chromeAlpha} 60%, ${accentMix})`)
    root.style.setProperty('--glass-bg-editor', `color-mix(in srgb, ${chromeAlpha} 65%, ${accentMix})`)
    root.style.setProperty('--glass-bg-elevated', `color-mix(in srgb, ${chromeAlpha} 75%, ${accentMix})`)
    root.style.setProperty('--glass-bg-bubble', `color-mix(in srgb, ${chromeAlpha} 55%, ${accentMix})`)
    root.style.setProperty('--glass-bg-input', `color-mix(in srgb, ${chromeAlpha} 50%, ${accentMix})`)
    root.style.setProperty('--glass-border', isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)')
  } else {
    root.classList.remove('glass-mode')
    root.style.removeProperty('--glass-body-top')
    root.style.removeProperty('--glass-body-bottom')
    root.style.removeProperty('--glass-bg-chrome')
    root.style.removeProperty('--glass-bg-sidebar')
    root.style.removeProperty('--glass-bg-editor')
    root.style.removeProperty('--glass-bg-elevated')
    root.style.removeProperty('--glass-bg-bubble')
    root.style.removeProperty('--glass-bg-input')
    root.style.removeProperty('--glass-border')
  }

  // 4. 🔴 2026-08-18 老大需求：macOS 主题系统完善——外观参数应用

  // 4a. 边栏色调：false → 中性灰边栏（覆盖 --theme-sidebar-background，
  //    色相与 accent 解耦；macOS「允许墙纸调色」的桌面等价物）
  root.dataset.sidebarTint = sidebarTint ? 'tinted' : 'plain'
  if (!sidebarTint) {
    root.style.setProperty('--theme-sidebar-background', neutralSidebarFor(isDark))
  } else {
    root.style.removeProperty('--theme-sidebar-background')
  }

  // 4b. 降低透明度：关闭全部 backdrop-filter（玻璃表面降级为接近不透明）
  root.classList.toggle('reduce-transparency', reduceTransparency)

  // 4c. 减弱动态效果：禁用动画/过渡（对齐系统级 reduced-motion 语义）
  root.classList.toggle('reduce-motion', reduceMotion)

  // 4d. 文字大小：--dt-base-size 驱动根字号（html font-size）
  root.style.setProperty('--dt-base-size', FONT_SCALE_SIZES[fontScale])
}

// ─── Boot-time paint ────────────────────────────────────────────────────────

/** 🔴 2026-08-18 读取全部外观选项（边栏色调/降低透明度/减弱动态/文字大小）——
 *  主窗口 boot paint 与看板独立窗口（KanbanWindowApp）共用，保持多窗口一致 */
export function loadThemeAppearanceOptions(): ThemeAppearanceOptions {
  return {
    sidebarTint: loadSidebarTint(),
    reduceTransparency: loadReduceTransparency(),
    reduceMotion: loadReduceMotion(),
    fontScale: loadFontScale(),
  }
}

if (typeof window !== 'undefined') {
  const accent = loadAccent()
  const appearance = loadAppearance()
  const systemDark = getSystemDarkMode()
  const isDark = appearance === 'dark' || (appearance !== 'light' && systemDark)
  const isGlass = appearance === 'glass'
  const colors = deriveColors(accent, isDark)
  applyThemeCSS(colors, isDark, isGlass, accent, loadThemeAppearanceOptions())
  // 启动时初始化窗口效果（DWM 原生合成）
  call('set_window_effect', { appearance })
    .catch(() => {}) // 静默失败，不阻塞启动
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  /** 派生主色 hex（= 渐变 pos 0.5 插值色；旧消费方兼容） */
  accent: string
  /** 🔴 2026-08-18 主题色渐变锚点（面板锚点滑块编辑的真实数据） */
  accentGradient: AccentGradient
  appearance: Appearance
  isDark: boolean
  isGlass: boolean
  colors: DerivedColors
  setAccent: (color: string) => void
  /** 🔴 2026-08-18 设置整个渐变（多锚点）；单色时传双同色锚点 */
  setAccentGradient: (stops: AccentGradient) => void
  setAppearance: (appearance: Appearance) => void
  accentColors: typeof ACCENT_COLORS
  // 🔴 2026-08-18 老大需求：macOS 主题系统完善——新增 4 项
  sidebarTint: SidebarTint
  setSidebarTint: (v: SidebarTint) => void
  reduceTransparency: boolean
  setReduceTransparency: (v: boolean) => void
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
  fontScale: FontScale
  setFontScale: (v: FontScale) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  accent: DEFAULT_ACCENT,
  accentGradient: parseAccentGradient(DEFAULT_ACCENT),
  appearance: DEFAULT_APPEARANCE,
  isDark: false,
  isGlass: false,
  colors: deriveColors(DEFAULT_ACCENT, false),
  setAccent: () => {},
  setAccentGradient: () => {},
  setAppearance: () => {},
  accentColors: ACCENT_COLORS,
  sidebarTint: DEFAULT_SIDEBAR_TINT,
  setSidebarTint: () => {},
  reduceTransparency: DEFAULT_REDUCE_TRANSPARENCY,
  setReduceTransparency: () => {},
  reduceMotion: DEFAULT_REDUCE_MOTION,
  setReduceMotion: () => {},
  fontScale: DEFAULT_FONT_SCALE,
  setFontScale: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 🔴 2026-08-18 主题色改为多锚点渐变（accent 主色由渐变派生，旧消费方兼容）
  const [accentGradient, setAccentGradientState] = useState<AccentGradient>(() =>
    typeof window === 'undefined' ? parseAccentGradient(DEFAULT_ACCENT) : loadAccentGradient()
  )
  const accent = useMemo(() => gradientMidColor(accentGradient), [accentGradient])
  const [appearance, setAppearanceState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_APPEARANCE : loadAppearance()
  )
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? false : getSystemDarkMode()
  )
  // 🔴 2026-08-18 老大需求：macOS 主题系统完善——4 项新状态
  const [sidebarTint, setSidebarTintState] = useState<SidebarTint>(() =>
    typeof window === 'undefined' ? DEFAULT_SIDEBAR_TINT : loadSidebarTint()
  )
  const [reduceTransparency, setReduceTransparencyState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_REDUCE_TRANSPARENCY : loadReduceTransparency()
  )
  const [reduceMotion, setReduceMotionState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_REDUCE_MOTION : loadReduceMotion()
  )
  const [fontScale, setFontScaleState] = useState<FontScale>(() =>
    typeof window === 'undefined' ? DEFAULT_FONT_SCALE : loadFontScale()
  )

  // 监听系统明暗变化
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 计算实际明暗
  const isDark = useMemo(() => {
    if (appearance === 'dark') return true
    if (appearance === 'light') return false
    return systemDark // auto / glass 跟随系统
  }, [appearance, systemDark])

  const isGlass = appearance === 'glass'

  // 派生颜色
  const colors = useMemo(() => deriveColors(accent, isDark), [accent, isDark])

  // 应用 CSS
  useEffect(() => {
    applyThemeCSS(colors, isDark, isGlass, accent, {
      sidebarTint,
      reduceTransparency,
      reduceMotion,
      fontScale,
    })
  }, [colors, isDark, isGlass, accent, sidebarTint, reduceTransparency, reduceMotion, fontScale])

  // 设置函数（写入本地 + 后端同步，失败不阻塞 UI）
  const setAccent = useCallback((color: string) => {
    setAccentGradientState(parseAccentGradient(color))
    saveAccentGradient(parseAccentGradient(color))
    call('update_config', { config: { display: { accent: serializeAccentGradient(parseAccentGradient(color)) } } })
      .catch(() => console.warn('[Theme] 后端配置同步失败'))
    // 通知其他窗口（看板等）
    emit('theme-changed', { accent: gradientMidColor(parseAccentGradient(color)), appearance: loadAppearance() })
      .catch(() => console.warn('[Theme] 事件发送失败'))
  }, [])

  // 🔴 2026-08-18 老大需求：多锚点渐变设置（面板锚点滑块编辑入口）
  const setAccentGradient = useCallback((stops: AccentGradient) => {
    const normalized = parseAccentGradient(serializeAccentGradient(stops))
    setAccentGradientState(normalized)
    saveAccentGradient(normalized)
    call('update_config', { config: { display: { accent: serializeAccentGradient(normalized) } } })
      .catch(() => console.warn('[Theme] 后端配置同步失败'))
    emit('theme-changed', { accent: gradientMidColor(normalized), appearance: loadAppearance() })
      .catch(() => console.warn('[Theme] 事件发送失败'))
  }, [])

  const setAppearance = useCallback((newAppearance: Appearance) => {
    setAppearanceState(newAppearance)
    saveAppearance(newAppearance)
    call('update_config', { config: { display: { appearance: newAppearance } } })
      .catch(() => console.warn('[Theme] 后端配置同步失败'))
    // 通知 Rust 侧设置窗口毛玻璃效果（DWM 原生合成）
    call('set_window_effect', { appearance: newAppearance })
      .catch(() => console.warn('[Theme] 窗口效果设置失败'))
    // 通知其他窗口（看板等）
    emit('theme-changed', { accent: loadAccent(), appearance: newAppearance })
      .catch(() => console.warn('[Theme] 事件发送失败'))
  }, [])

  // 启动时从后端同步（仅当本地无保存值时才使用后端值 —— 本地优先，防覆盖用户选择）
  useEffect(() => {
    call('get_config', {}).then((cfg: Record<string, unknown>) => {
      const display = cfg?.display as Record<string, unknown> | undefined
      const backendAccent = display?.accent as string | undefined
      const backendAppearance = display?.appearance as Appearance | undefined

      // 仅当本地 localStorage 无值（首次启动或缓存被清）时才从后端填充
      if (backendAccent && !localStorage.getItem(ACCENT_KEY)) {
        // 🔴 2026-08-18 后端值可能是旧 hex 或新 JSON 渐变——统一解析
        const gradient = parseAccentGradient(backendAccent)
        setAccentGradientState(gradient)
        saveAccentGradient(gradient)
      }
      if (backendAppearance && !localStorage.getItem(APPEARANCE_KEY)) {
        setAppearanceState(backendAppearance)
        saveAppearance(backendAppearance)
      }
      // 🔴 2026-08-18 新增 4 项同规则（本地无值 → 后端填充）
      if (typeof display?.sidebar_tint === 'boolean' && !localStorage.getItem(SIDEBAR_TINT_KEY)) {
        setSidebarTintState(display.sidebar_tint as SidebarTint)
        saveSidebarTint(display.sidebar_tint as SidebarTint)
      }
      if (typeof display?.reduce_transparency === 'boolean' && !localStorage.getItem(REDUCE_TRANSPARENCY_KEY)) {
        setReduceTransparencyState(Boolean(display.reduce_transparency))
        saveReduceTransparency(Boolean(display.reduce_transparency))
      }
      if (typeof display?.reduce_motion === 'boolean' && !localStorage.getItem(REDUCE_MOTION_KEY)) {
        setReduceMotionState(Boolean(display.reduce_motion))
        saveReduceMotion(Boolean(display.reduce_motion))
      }
      if (typeof display?.font_scale === 'string' && !localStorage.getItem(FONT_SCALE_KEY)) {
        const fs = display.font_scale as FontScale
        if (fs === 'small' || fs === 'medium' || fs === 'large') {
          setFontScaleState(fs)
          saveFontScale(fs)
        }
      }
    }).catch(() => {})
  }, []) // 只在挂载时执行一次

  // 🔴 2026-08-18 老大需求：4 项新设置 setter（本地 + 后端同步，失败不阻塞 UI；
  // emit theme-changed 让看板等独立窗口经 loadThemeAppearanceOptions 同步）
  const syncThemeChanged = useCallback(() => {
    emit('theme-changed', { accent: loadAccent(), appearance: loadAppearance() })
      .catch(() => console.warn('[Theme] 事件发送失败'))
  }, [])

  const setSidebarTint = useCallback((v: SidebarTint) => {
    setSidebarTintState(v)
    saveSidebarTint(v)
    call('update_config', { config: { display: { sidebar_tint: v } } }).catch(() => {})
    syncThemeChanged()
  }, [syncThemeChanged])

  const setReduceTransparency = useCallback((v: boolean) => {
    setReduceTransparencyState(v)
    saveReduceTransparency(v)
    call('update_config', { config: { display: { reduce_transparency: v } } }).catch(() => {})
    syncThemeChanged()
  }, [syncThemeChanged])

  const setReduceMotion = useCallback((v: boolean) => {
    setReduceMotionState(v)
    saveReduceMotion(v)
    call('update_config', { config: { display: { reduce_motion: v } } }).catch(() => {})
    syncThemeChanged()
  }, [syncThemeChanged])

  const setFontScale = useCallback((v: FontScale) => {
    setFontScaleState(v)
    saveFontScale(v)
    call('update_config', { config: { display: { font_scale: v } } }).catch(() => {})
    syncThemeChanged()
  }, [syncThemeChanged])

  const value = useMemo(
    () => ({
      accent,
      accentGradient,
      appearance,
      isDark,
      isGlass,
      colors,
      setAccent,
      setAccentGradient,
      setAppearance,
      accentColors: ACCENT_COLORS,
      sidebarTint,
      setSidebarTint,
      reduceTransparency,
      setReduceTransparency,
      reduceMotion,
      setReduceMotion,
      fontScale,
      setFontScale,
    }),
    [accent, accentGradient, appearance, isDark, isGlass, colors, setAccent, setAccentGradient, setAppearance, sidebarTint, setSidebarTint, reduceTransparency, setReduceTransparency, reduceMotion, setReduceMotion, fontScale, setFontScale]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
