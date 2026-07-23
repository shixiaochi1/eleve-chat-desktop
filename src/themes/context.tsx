/**
 * 主题上下文 — 支持自定义颜色覆盖
 *
 * 7 套预设主题 + 自定义颜色覆盖
 * 用户选择预设主题后可逐变量调颜色，自定义颜色覆盖预设值
 *
 * 🔴 Config 架构 V2.0：皮肤持久化真相源是 config.yaml (display.skin)
 * localStorage + Tauri storage 是即时缓存（避免闪烁）
 * setTheme 同时写缓存 + 后端 config.set("display.skin")
 * 启动时优先从后端 config.get("display.skin") 读初始值
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as storage from '../utils/storage'
import { call } from '../utils/bridge'

import { BUILTIN_THEME_LIST, BUILTIN_THEMES, DEFAULT_SKIN_NAME, DEFAULT_TYPOGRAPHY, nousTheme } from './presets'
import type { DesktopTheme, DesktopThemeColors } from './types'

const SKIN_KEY = 'eleve-desktop-theme-v2'
const CUSTOM_COLORS_KEY = 'custom-theme-colors'

const INJECTED_FONT_URLS = new Set<string>()

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}

/** 任意颜色加透明度（支持 hex / rgba / color-mix） */
function hexToRgba(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

/** 根据背景色亮度判断是否为暗色模式 */
function isDarkColor(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  const [r, g, b] = rgb.map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.5
}

function readableOn(hex: string): string {
  return isDarkColor(hex) ? '#ffffff' : '#161616'
}

// ─── 自定义颜色加载/保存 ────────────────────────────────────────────────────

function loadCustomColors(): Partial<DesktopThemeColors> {
  try {
    // 优先从 localStorage 读取（同步可靠）
    const local = localStorage.getItem(CUSTOM_COLORS_KEY)
    if (local) return JSON.parse(local) as Partial<DesktopThemeColors>
    // 降级：从 AppService storage 读取
    const saved = storage.load(CUSTOM_COLORS_KEY)
    if (saved && typeof saved === 'object') return saved as Partial<DesktopThemeColors>
  } catch { /* ignore */ }
  return {}
}

function saveCustomColors(colors: Partial<DesktopThemeColors>): void {
  // 双写：localStorage + AppService
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors))
  storage.save(CUSTOM_COLORS_KEY, colors)
}

function clearCustomColors(): void {
  localStorage.removeItem(CUSTOM_COLORS_KEY)
  storage.remove(CUSTOM_COLORS_KEY)
}

/** 主题名持久化 — 双写 */
function loadThemeName(): string {
  // 优先 localStorage
  const local = localStorage.getItem(SKIN_KEY)
  if (local) return local
  // 降级 storage
  const saved = storage.load(SKIN_KEY) as string | null
  return saved ?? DEFAULT_SKIN_NAME
}

function saveThemeName(name: string): void {
  localStorage.setItem(SKIN_KEY, name)
  storage.save(SKIN_KEY, name)
  // 🔴 Config 架构 V2.0：同步写后端 config.yaml (display.skin)
  // 火即发，不 await（不阻塞 UI，失败静默——localStorage 已保证即时生效）
  call('update_config', { config: { display: { skin: name } } }).catch(() => {})
}

// ─── CSS 注入 ───────────────────────────────────────────────────────────────

const mixesFor = (isDark: boolean) => ({
  '--theme-mix-chrome': isDark ? '74%' : '92%',
  '--theme-mix-sidebar': '100%',
  '--theme-mix-card': isDark ? '38%' : '22%',
  '--theme-mix-elevated': isDark ? '46%' : '28%',
  '--theme-mix-bubble': isDark ? '46%' : '0%',
})

/** 合并预设主题颜色和自定义覆盖 */
function mergeColors(base: DesktopThemeColors, overrides: Partial<DesktopThemeColors>): DesktopThemeColors {
  return { ...base, ...overrides }
}

function applyThemeCSS(theme: DesktopTheme, customOverrides: Partial<DesktopThemeColors> = {}) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  // 合并自定义颜色
  const c = mergeColors(theme.colors, customOverrides)
  const typo = { ...DEFAULT_TYPOGRAPHY, ...theme.typography }
  const isDark = isDarkColor(c.background)
  const midground = c.midground ?? c.ring

  // 1. Dark class + color-scheme
  root.classList.toggle('dark', isDark)
  root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')
  root.dataset.eleveTheme = theme.name
      root.dataset.eleveMode = isDark ? 'dark' : 'light'

  // 2. Brand seeds
  const seeds: Record<string, string> = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': midground,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover,
  }

  // 3. Direct palette tokens
  const palette: Record<string, string> = {
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-muted': c.muted,
    '--dt-midground-foreground': c.midgroundForeground ?? readableOn(midground),
    '--dt-composer-ring': c.composerRing ?? midground,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-border': c.sidebarBorder ?? c.border,
    '--dt-user-bubble-border': c.userBubbleBorder ?? c.border,
    '--dt-font-sans': typo.fontSans,
    '--dt-font-mono': typo.fontMono,
    '--noise-opacity-mul': isDark ? 'calc(0.04 / 0.21)' : 'calc(0.34 / 0.21)',

    // ── 直接覆盖语义层 — 防止 CSS 硬编码覆盖 ──
    '--ui-bg-chrome': c.background,
    '--ui-bg-sidebar': c.sidebarBackground ?? c.background,
    '--ui-bg-editor': c.card,
    '--ui-bg-elevated': c.popover,
    '--ui-bg-backboard': c.background,
    '--ui-surface-background': c.card,
    '--ui-sidebar-surface-background': c.sidebarBackground ?? c.background,
    '--ui-chat-surface-background': c.background,
    '--ui-editor-surface-background': c.background,
    '--theme-neutral-chrome': c.background,
    '--theme-neutral-sidebar': c.sidebarBackground ?? c.background,
    '--theme-neutral-card': c.card,

    // ── 暗色模式特有变量 ──
    '--sidebar-edge-border': isDark
      ? `color-mix(in srgb, ${c.foreground} 12%, transparent)`
      : `color-mix(in srgb, ${c.foreground} 7.5%, transparent)`,
    '--composer-ring-strength': isDark ? '1.3' : '1',
    '--backdrop-invert-mul': isDark ? '0' : '1',

    // ── 暗色模式语义色调整 ──
    '--ui-red': isDark ? '#e75e78' : '#cf2d56',
    '--ui-orange': isDark ? '#e8926e' : '#db704b',
    '--ui-yellow': isDark ? '#d9a557' : '#c08532',
    '--ui-green': isDark ? '#55a583' : '#1f8a65',
    '--ui-cyan': isDark ? '#6f9ba6' : '#4c7f8c',
    '--ui-blue': isDark ? '#6b9cff' : '#0053fd',
    '--ui-purple': isDark ? '#b3a9e8' : '#9e94d5',
    '--ui-pink': isDark ? '#e88fb8' : '#c25a8e',

    // ── 内联代码和选区（暗色用白色半透明，浅色用黑色半透明） ──
    '--ui-inline-code-background': isDark
      ? 'color-mix(in srgb, #ffffff 7%, transparent)'
      : 'color-mix(in srgb, #141414 5%, transparent)',
    '--ui-inline-code-border': isDark
      ? 'color-mix(in srgb, #ffffff 10%, transparent)'
      : 'color-mix(in srgb, #141414 8%, transparent)',
    '--ui-inline-code-foreground': isDark
      ? 'color-mix(in srgb, #ffffff 88%, transparent)'
      : 'color-mix(in srgb, #141414 88%, transparent)',
    '--ui-selection-background': isDark
      ? 'color-mix(in srgb, #ffd24a 38%, transparent)'
      : 'color-mix(in srgb, #ffd24a 55%, transparent)',

    // ── 幻影变量别名 ──
    '--text-secondary': 'var(--ui-text-secondary)',
    '--text': 'var(--ui-text-primary)',
    '--success': 'var(--ui-green)',
    '--error': 'var(--ui-red)',
    '--danger': 'var(--dt-destructive)',
    '--accent': 'var(--dt-accent-foreground)',

    // ── 方案C: 卡片颜色（从主题色派生）──
    '--ui-card-bg': hexToRgba(c.card, 0.92),
    '--ui-card-border': hexToRgba(isDark ? '#ffffff' : '#000000', 0.15),
    '--ui-card-shadow-outer': 'rgba(0, 0, 0, 0.4)',
    '--ui-card-shadow-inner': 'rgba(0, 0, 0, 0.3)',
    '--ui-card-highlight': hexToRgba(isDark ? '#ffffff' : '#000000', 0.05),
    '--ui-card-glow-cyan': hexToRgba(c.primary, 0.5),
    '--ui-card-glow-purple': hexToRgba(c.midground || c.primary, 0.5),
    '--ui-card-glow-cyan-mid': hexToRgba(c.primary, 0.3),
    '--ui-card-glow-purple-mid': hexToRgba(c.midground || c.primary, 0.3),
  }

  for (const [k, v] of Object.entries({ ...seeds, ...mixesFor(isDark), ...palette })) {
    root.style.setProperty(k, v)
  }

  // 4. Radius scalar — ensure border-radius works on fresh installs
  root.style.setProperty('--radius-scalar', '0.6')
  root.style.setProperty('--radius', '0.75rem')

  // 5. Font injection
  if (typo.fontUrl && !INJECTED_FONT_URLS.has(typo.fontUrl)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = typo.fontUrl
    link.dataset.eleveThemeFont = 'true'
    document.head.appendChild(link)
    INJECTED_FONT_URLS.add(typo.fontUrl)
  }
}

// ─── Boot-time paint (避免闪烁) ─────────────────────────────────────────────

function normalizeSkin(name: string | null): string {
  return name && BUILTIN_THEMES[name] ? name : DEFAULT_SKIN_NAME
}

if (typeof window !== 'undefined') {
  const skin = normalizeSkin(loadThemeName())
  const theme = BUILTIN_THEMES[skin] ?? nousTheme
  const custom = loadCustomColors()
  applyThemeCSS(theme, custom)
}

// ─── Context ────────────────────────────────────────────────────────────────

const SKIN_LIST = BUILTIN_THEME_LIST.map(({ name, label, description }) => ({ name, label, description }))

interface ThemeContextValue {
  theme: DesktopTheme
  themeName: string
  isDark: boolean
  customColors: Partial<DesktopThemeColors>
  hasCustomColors: boolean
  availableThemes: { name: string; label: string; description: string }[]
  setTheme: (name: string) => void
  setCustomColor: (key: keyof DesktopThemeColors, value: string) => void
  setCustomColors: (colors: Partial<DesktopThemeColors>) => void
  resetCustomColors: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: nousTheme,
  themeName: DEFAULT_SKIN_NAME,
  isDark: false,
  customColors: {},
  hasCustomColors: false,
  availableThemes: SKIN_LIST,
  setTheme: () => {},
  setCustomColor: () => {},
  setCustomColors: () => {},
  resetCustomColors: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_SKIN_NAME : normalizeSkin(loadThemeName())
  )

  const [customColors, setCustomColorsState] = useState<Partial<DesktopThemeColors>>(() =>
    typeof window === 'undefined' ? {} : loadCustomColors()
  )

  // 🔴 Config 架构 V2.0：启动时从后端 config.yaml display.skin 同步皮肤
  // 后端是持久化真相源，localStorage 是即时缓存
  // 只在首次加载时同步一次（后端皮肤覆盖本地缓存）
  const [backendSynced, setBackendSynced] = useState(false)
  useEffect(() => {
    if (backendSynced) return
    call('get_config', {}).then((cfg: Record<string, unknown>) => {
      const display = cfg?.display as Record<string, unknown> | undefined
      const skin = display?.skin as string | undefined
      if (skin && BUILTIN_THEMES[skin]) {
        const local = normalizeSkin(loadThemeName())
        if (local !== skin) {
          setThemeNameState(skin)
          saveThemeName(skin)
        }
      }
      setBackendSynced(true)
    }).catch(() => { setBackendSynced(true) })
  }, [backendSynced])

  const baseTheme = useMemo(() => BUILTIN_THEMES[themeName] ?? nousTheme, [themeName])

  // 合并后的主题（预设 + 自定义覆盖）
  const activeTheme = useMemo((): DesktopTheme => {
    if (Object.keys(customColors).length === 0) return baseTheme
    return {
      ...baseTheme,
      colors: mergeColors(baseTheme.colors, customColors),
    }
  }, [baseTheme, customColors])

  const isDark = useMemo(() => isDarkColor(activeTheme.colors.background), [activeTheme])

  useEffect(() => { applyThemeCSS(baseTheme, customColors) }, [baseTheme, customColors])

  const setTheme = useCallback((name: string) => {
    const next = normalizeSkin(name)
    setThemeNameState(next)
    saveThemeName(next)
  }, [])

  const setCustomColor = useCallback((key: keyof DesktopThemeColors, value: string) => {
    setCustomColorsState(prev => {
      const next = { ...prev, [key]: value }
      saveCustomColors(next)
      return next
    })
  }, [])

  const setCustomColors = useCallback((colors: Partial<DesktopThemeColors>) => {
    setCustomColorsState(colors)
    saveCustomColors(colors)
  }, [])

  const resetCustomColors = useCallback(() => {
    setCustomColorsState({})
    clearCustomColors()
  }, [])

  const value = useMemo(
    () => ({
      theme: activeTheme,
      themeName,
      isDark,
      customColors,
      hasCustomColors: Object.keys(customColors).length > 0,
      availableThemes: SKIN_LIST,
      setTheme,
      setCustomColor,
      setCustomColors,
      resetCustomColors,
    }),
    [activeTheme, themeName, isDark, customColors, setTheme, setCustomColor, setCustomColors, resetCustomColors]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)

/** @deprecated 保留兼容 */
export function useSyncThemeFromBackend(backendThemeName: string | null | undefined, setTheme: (name: string) => void) {
  // 🔴 Config 架构 V2.0：从后端 config.yaml display.skin 同步皮肤
  // 当后端皮肤名和前端不同时，以后端为准（后端是持久化真相源）
  useEffect(() => {
    if (backendThemeName && BUILTIN_THEMES[backendThemeName]) {
      const local = normalizeSkin(loadThemeName())
      if (local !== backendThemeName) {
        setTheme(backendThemeName)
      }
    }
  }, [backendThemeName, setTheme])
}
