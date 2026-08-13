/**
 * 主题上下文 — macOS 风格
 * 
 * 核心设计：
 * - 只有 2 个用户可控参数：accent（强调色）+ appearance（外观模式）
 * - 所有颜色从这两个参数自动派生
 * - 明暗模式独立于强调色
 * 
 * 持久化：
 * - localStorage + Tauri storage 双写（即时缓存）
 * - 后端 config.yaml 同步（持久化真相源）
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as storage from '../utils/storage'
import { call } from '../utils/bridge'
import { deriveColors, ACCENT_COLORS, DEFAULT_ACCENT, DEFAULT_APPEARANCE, type Appearance, type DerivedColors } from './derive'

const ACCENT_KEY = 'eleve-accent-color'
const APPEARANCE_KEY = 'eleve-appearance'

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

function loadAccent(): string {
  const local = localStorage.getItem(ACCENT_KEY)
  if (local) return local
  const saved = storage.load(ACCENT_KEY) as string | null
  return saved ?? DEFAULT_ACCENT
}

function saveAccent(color: string): void {
  localStorage.setItem(ACCENT_KEY, color)
  storage.save(ACCENT_KEY, color)
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

// ─── 系统明暗检测 ───────────────────────────────────────────────────────────

function getSystemDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ─── CSS 注入 ───────────────────────────────────────────────────────────────

function applyThemeCSS(colors: DerivedColors, isDark: boolean, isGlass: boolean) {
  if (typeof document === 'undefined') return

  const root = document.documentElement

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

  // 3. Glass 模式特殊处理（明暗模式使用不同的半透明基底）
  if (isGlass) {
    root.classList.add('glass-mode')
    if (isDark) {
      root.style.setProperty('--glass-bg-chrome', 'rgba(28,28,30,0.55)')
      root.style.setProperty('--glass-bg-sidebar', 'rgba(28,28,30,0.48)')
      root.style.setProperty('--glass-bg-editor', 'rgba(44,44,46,0.58)')
      root.style.setProperty('--glass-bg-elevated', 'rgba(58,58,60,0.65)')
      root.style.setProperty('--glass-bg-bubble', 'rgba(44,44,46,0.50)')
      root.style.setProperty('--glass-bg-input', 'rgba(28,28,30,0.45)')
      root.style.setProperty('--glass-border', 'rgba(255,255,255,0.12)')
    } else {
      root.style.setProperty('--glass-bg-chrome', 'rgba(255,255,255,0.45)')
      root.style.setProperty('--glass-bg-sidebar', 'rgba(255,255,255,0.38)')
      root.style.setProperty('--glass-bg-editor', 'rgba(255,255,255,0.48)')
      root.style.setProperty('--glass-bg-elevated', 'rgba(255,255,255,0.55)')
      root.style.setProperty('--glass-bg-bubble', 'rgba(255,255,255,0.40)')
      root.style.setProperty('--glass-bg-input', 'rgba(255,255,255,0.35)')
      root.style.setProperty('--glass-border', 'rgba(255,255,255,0.22)')
    }
  } else {
    root.classList.remove('glass-mode')
    root.style.removeProperty('--glass-bg-chrome')
    root.style.removeProperty('--glass-bg-sidebar')
    root.style.removeProperty('--glass-bg-editor')
    root.style.removeProperty('--glass-bg-elevated')
    root.style.removeProperty('--glass-bg-bubble')
    root.style.removeProperty('--glass-bg-input')
    root.style.removeProperty('--glass-border')
  }
}

// ─── Boot-time paint ────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  const accent = loadAccent()
  const appearance = loadAppearance()
  const systemDark = getSystemDarkMode()
  const isDark = appearance === 'dark' || (appearance !== 'light' && systemDark)
  const isGlass = appearance === 'glass'
  const colors = deriveColors(accent, isDark)
  applyThemeCSS(colors, isDark, isGlass)
  // 启动时初始化窗口效果（DWM 原生合成）
  call('set_window_effect', { appearance })
    .catch(() => {}) // 静默失败，不阻塞启动
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  accent: string
  appearance: Appearance
  isDark: boolean
  isGlass: boolean
  colors: DerivedColors
  setAccent: (color: string) => void
  setAppearance: (appearance: Appearance) => void
  accentColors: typeof ACCENT_COLORS
}

const ThemeContext = createContext<ThemeContextValue>({
  accent: DEFAULT_ACCENT,
  appearance: DEFAULT_APPEARANCE,
  isDark: false,
  isGlass: false,
  colors: deriveColors(DEFAULT_ACCENT, false),
  setAccent: () => {},
  setAppearance: () => {},
  accentColors: ACCENT_COLORS,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_ACCENT : loadAccent()
  )
  const [appearance, setAppearanceState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_APPEARANCE : loadAppearance()
  )
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? false : getSystemDarkMode()
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
    applyThemeCSS(colors, isDark, isGlass)
  }, [colors, isDark, isGlass])

  // 设置函数（写入本地 + 后端同步，失败不阻塞 UI）
  const setAccent = useCallback((color: string) => {
    setAccentState(color)
    saveAccent(color)
    call('update_config', { config: { display: { accent: color } } })
      .catch(() => console.warn('[Theme] 后端配置同步失败'))
  }, [])

  const setAppearance = useCallback((newAppearance: Appearance) => {
    setAppearanceState(newAppearance)
    saveAppearance(newAppearance)
    call('update_config', { config: { display: { appearance: newAppearance } } })
      .catch(() => console.warn('[Theme] 后端配置同步失败'))
    // 通知 Rust 侧设置窗口毛玻璃效果（DWM 原生合成）
    call('set_window_effect', { appearance: newAppearance })
      .catch(() => console.warn('[Theme] 窗口效果设置失败'))
  }, [])

  // 启动时从后端同步（仅当本地无保存值时才使用后端值 —— 本地优先，防覆盖用户选择）
  useEffect(() => {
    call('get_config', {}).then((cfg: Record<string, unknown>) => {
      const display = cfg?.display as Record<string, unknown> | undefined
      const backendAccent = display?.accent as string | undefined
      const backendAppearance = display?.appearance as Appearance | undefined

      // 仅当本地 localStorage 无值（首次启动或缓存被清）时才从后端填充
      if (backendAccent && !localStorage.getItem(ACCENT_KEY)) {
        setAccentState(backendAccent)
        saveAccent(backendAccent)
      }
      if (backendAppearance && !localStorage.getItem(APPEARANCE_KEY)) {
        setAppearanceState(backendAppearance)
        saveAppearance(backendAppearance)
      }
    }).catch(() => {})
  }, []) // 只在挂载时执行一次

  const value = useMemo(
    () => ({
      accent,
      appearance,
      isDark,
      isGlass,
      colors,
      setAccent,
      setAppearance,
      accentColors: ACCENT_COLORS,
    }),
    [accent, appearance, isDark, isGlass, colors, setAccent, setAppearance]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
