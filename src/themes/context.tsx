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

  // 2. 直接注入所有派生颜色
  const vars: Record<string, string> = {
    // 背景层
    '--dt-background': colors.background,
    '--dt-foreground': colors.foreground,
    '--dt-card': colors.card,
    '--dt-card-foreground': colors.cardForeground,
    '--dt-popover': colors.popover,
    '--dt-popover-foreground': colors.popoverForeground,
    
    // 文字层
    '--dt-muted': colors.muted,
    '--dt-muted-foreground': colors.mutedForeground,
    
    // 主色层
    '--dt-primary': colors.primary,
    '--dt-primary-foreground': colors.primaryForeground,
    '--dt-secondary': colors.secondary,
    '--dt-secondary-foreground': colors.secondaryForeground,
    '--dt-accent': colors.accent,
    '--dt-accent-foreground': colors.accentForeground,
    
    // 边框层
    '--dt-border': colors.border,
    '--dt-input': colors.input,
    '--dt-ring': colors.ring,
    '--dt-midground': colors.midground,
    '--dt-composer-ring': colors.composerRing,
    
    // 语义层
    '--dt-destructive': colors.destructive,
    '--dt-destructive-foreground': colors.destructiveForeground,
    
    // 侧边栏
    '--dt-sidebar-background': colors.sidebarBackground,
    '--dt-sidebar-border': colors.sidebarBorder,
    
    // 气泡
    '--dt-user-bubble': colors.userBubble,
    '--dt-user-bubble-border': colors.userBubbleBorder,
    
    // 语义色（红/绿/黄/蓝等）
    '--ui-red': isDark ? '#FF453A' : '#FF3B30',
    '--ui-green': isDark ? '#34C759' : '#34C759',
    '--ui-yellow': isDark ? '#FFCC00' : '#FFCC00',
    '--ui-blue': isDark ? '#007AFF' : '#007AFF',
    '--ui-purple': isDark ? '#AF52DE' : '#AF52DE',
    '--ui-orange': isDark ? '#FF9500' : '#FF9500',
    '--ui-pink': isDark ? '#FF2D55' : '#FF2D55',
    '--ui-cyan': isDark ? '#5AC8FA' : '#5AC8FA',
  }

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }

  // 3. Glass 模式特殊处理
  if (isGlass) {
    root.classList.add('glass-mode')
    root.style.setProperty('--glass-bg-chrome', 'rgba(255,255,255,0.45)')
    root.style.setProperty('--glass-bg-sidebar', 'rgba(255,255,255,0.38)')
    root.style.setProperty('--glass-bg-editor', 'rgba(255,255,255,0.48)')
    root.style.setProperty('--glass-bg-elevated', 'rgba(255,255,255,0.55)')
    root.style.setProperty('--glass-bg-bubble', 'rgba(255,255,255,0.40)')
    root.style.setProperty('--glass-bg-input', 'rgba(255,255,255,0.35)')
    root.style.setProperty('--glass-border', 'rgba(255,255,255,0.22)')
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
  const isDark = appearance === 'dark' || (appearance === 'auto' && getSystemDarkMode())
  const isGlass = appearance === 'glass'
  const colors = deriveColors(accent, isDark)
  applyThemeCSS(colors, isDark, isGlass)
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
    if (appearance === 'glass') return false
    if (appearance === 'dark') return true
    if (appearance === 'light') return false
    return systemDark // auto
  }, [appearance, systemDark])

  const isGlass = appearance === 'glass'

  // 派生颜色
  const colors = useMemo(() => deriveColors(accent, isDark), [accent, isDark])

  // 应用 CSS
  useEffect(() => {
    applyThemeCSS(colors, isDark, isGlass)
  }, [colors, isDark, isGlass])

  // 设置函数
  const setAccent = useCallback((color: string) => {
    setAccentState(color)
    saveAccent(color)
    // 同步到后端
    call('update_config', { config: { display: { accent: color } } }).catch(() => {})
  }, [])

  const setAppearance = useCallback((newAppearance: Appearance) => {
    setAppearanceState(newAppearance)
    saveAppearance(newAppearance)
    // 同步到后端
    call('update_config', { config: { display: { appearance: newAppearance } } }).catch(() => {})
  }, [])

  // 启动时从后端同步
  useEffect(() => {
    call('get_config', {}).then((cfg: Record<string, unknown>) => {
      const display = cfg?.display as Record<string, unknown> | undefined
      const backendAccent = display?.accent as string | undefined
      const backendAppearance = display?.appearance as Appearance | undefined
      
      if (backendAccent && backendAccent !== accent) {
        setAccentState(backendAccent)
        saveAccent(backendAccent)
      }
      if (backendAppearance && backendAppearance !== appearance) {
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
