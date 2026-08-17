/**
 * ThemePanel — macOS 风格主题设置（对齐 System Settings → 外观 + 辅助功能）
 *
 * 🔴 2026-08-18 老大需求（两轮收敛）：
 * ① 完善 ELEVE 主题系统，借鉴 macOS 主题体系：
 *    - 外观：浅色/深色/自动/毛玻璃 —— 每个选项带真实派生色的迷你窗口缩略图
 *    - 边栏色调 / 降低透明度 / 减弱动态效果 / 文字大小：macOS 等价物
 * ② 强调色 → 主题色；自定义颜色改为自绘取色面板（macOS NSColorPanel 语言：
 *    2D 色场 + 色相条 + hex 输入 + 微色板），替代简陋的原生 color input。
 *    （多锚点渐变方案已按老大指示搁置——保持单色主题色 + 静态预览条）
 *
 * 颜色铁律：本组件不允许硬编码色值——卡片/缩略图/色场/色相条全部由
 * useTheme().colors、deriveColors()、ACCENT_COLORS、HSL 算法派生。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Sun, Moon, Monitor, Sparkles, Type } from 'lucide-react'
import { useTheme, deriveColors, getReadableOnAccent, ACCENT_COLORS, hexToHsl, hslToHex } from '../themes'
import type { Appearance, DerivedColors, FontScale } from '../themes/derive'
import { cn } from '@/lib/utils'
import { Switch } from './ui/switch'

const APPEARANCE_OPTIONS: { value: Appearance; label: string; icon: ReactNode }[] = [
  { value: 'light', label: '浅色', icon: <Sun size={14} strokeWidth={1.5} /> },
  { value: 'dark', label: '深色', icon: <Moon size={14} strokeWidth={1.5} /> },
  { value: 'auto', label: '自动', icon: <Monitor size={14} strokeWidth={1.5} /> },
  { value: 'glass', label: '毛玻璃', icon: <Sparkles size={14} strokeWidth={1.5} /> },
]

const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '标准' },
  { value: 'large', label: '大' },
]

/** 自定义取色器的彩虹底 — 由 ACCENT_COLORS 派生（macOS 色环同源，零硬编码） */
const RAINBOW_GRADIENT = `conic-gradient(${[
  ...ACCENT_COLORS.map((c) => c.color),
  ACCENT_COLORS[0].color,
].join(', ')})`

/** 色相条彩虹轨道 — HSL 算法生成（h=0..360 标准色序，零硬编码） */
const HUE_TRACK = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360]
  .map((h) => hslToHex(h, 100, 50))
  .join(', ')})`

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// ═══════════════════════════════════════════════════════════════════════════
// 自绘取色面板（macOS NSColorPanel 简化版：2D 色场 + 色相条 + hex + 微色板）
// ═══════════════════════════════════════════════════════════════════════════

function ColorPickerPopover({ value, onChange, onClose }: {
  value: string
  onChange: (color: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const hueRef = useRef<HTMLDivElement | null>(null)
  const [hsl, setHsl] = useState(() => hexToHsl(value))
  const [hexDraft, setHexDraft] = useState(value)

  // 外部点击 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 外部颜色变化（如预设点选）→ 同步 hex 输入框。
  // 🔴 注意：不从 value 反推 HSL——纯白/纯黑会丢失色相（hsl→hex→hsl 不可逆），
  // 反推会让取色光标跳角；面板内部 hsl 恒为取色真源。
  useEffect(() => {
    setHexDraft(value)
  }, [value])

  const update = useCallback((next: Partial<{ h: number; s: number; l: number }>) => {
    setHsl((prev) => {
      const merged = { ...prev, ...next }
      onChange(hslToHex(merged.h, merged.s, merged.l))
      return merged
    })
  }, [onChange])

  const pickField = useCallback((clientX: number, clientY: number) => {
    const el = fieldRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    update({
      s: Math.round(clamp01((clientX - rect.left) / rect.width) * 100),
      l: Math.round((1 - clamp01((clientY - rect.top) / rect.height)) * 100),
    })
  }, [update])

  const pickHue = useCallback((clientX: number) => {
    const el = hueRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    update({ h: Math.round(clamp01((clientX - rect.left) / rect.width) * 360) })
  }, [update])

  const applyHex = useCallback(() => {
    const v = hexDraft.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const color = v.toLowerCase()
      setHsl(hexToHsl(color))
      onChange(color)
    } else {
      setHexDraft(value)
    }
  }, [hexDraft, value, onChange])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-2 w-[360px] rounded-xl border border-border/80 bg-popover p-4 shadow-lg"
      style={{ boxShadow: 'var(--shadow-lg)' }}
      role="dialog"
      aria-label="自定义颜色"
    >
      {/* 2D 色场（饱和度 × 亮度） */}
      <div
        ref={fieldRef}
        className="relative h-56 cursor-crosshair touch-none overflow-hidden rounded-lg border border-border/60"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hslToHex(hsl.h, 100, 50)})`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickField(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pickField(e.clientX, e.clientY)
        }}
      >
        {/* 取色光标 */}
        <span
          className="pointer-events-none absolute size-4.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_4px_rgba(0,0,0,0.35)]"
          style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* 色相条 */}
      <div
        ref={hueRef}
        className="relative mt-3 h-4 cursor-pointer touch-none rounded-full border border-border/60"
        style={{ background: HUE_TRACK }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickHue(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pickHue(e.clientX)
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_4px_rgba(0,0,0,0.35)]"
          style={{ left: `${(hsl.h / 360) * 100}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* 当前色 + hex 输入 */}
      <div className="mt-3 flex items-center gap-2">
        <span
          className="size-8 shrink-0 rounded-md border border-border/70"
          style={{ background: value, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.12)' }}
          aria-hidden
        />
        <span className="font-mono text-[11px] text-muted-foreground/60">#</span>
        <input
          value={hexDraft.startsWith('#') ? hexDraft.slice(1) : hexDraft}
          onChange={(e) => setHexDraft(`#${e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`)}
          onBlur={applyHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyHex()
            }
          }}
          className="h-8 w-[104px] rounded-md border border-border/70 bg-background px-1.5 font-mono text-xs uppercase outline-none focus:border-primary/60"
          aria-label="十六进制颜色值"
          spellCheck={false}
        />
        <span className="ml-auto text-[10px] text-muted-foreground/50">拖拽取色</span>
      </div>

      {/* 微色板（macOS 预设） */}
      <div className="mt-3 flex items-center gap-2">
        {ACCENT_COLORS.map(({ name, color }) => (
          <button
            key={color}
            type="button"
            onClick={() => {
              setHsl(hexToHsl(color))
              onChange(color)
              setHexDraft(color)
            }}
            className={cn(
              'size-6 rounded-full transition-transform duration-100 hover:scale-110',
              color.toLowerCase() === value.toLowerCase() &&
                'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background',
            )}
            style={{ background: color }}
            title={name}
            aria-label={name}
          />
        ))}
      </div>
    </div>
  )
}

/** 迷你窗口缩略图 — 全部消费真实派生色（macOS 预览卡片同构） */
function WindowMock({ colors, accent, glass, auto }: { colors: DerivedColors; accent: string; glass?: boolean; auto?: boolean }) {
  const autoDark = auto ? deriveColors(accent, true) : colors
  // auto 模式：内容区左浅右深分割（浅色侧用传入 colors，深色侧用暗色派生）
  const body = (
    <div className="flex" style={{ height: 52 }}>
      {/* 侧边栏 */}
      <div
        className="flex w-1/4 flex-col gap-1 p-1.5"
        style={{
          background: auto
            ? `linear-gradient(90deg, ${colors.sidebarBackground} 0%, ${colors.sidebarBackground} 55%, ${autoDark.sidebarBackground} 55%, ${autoDark.sidebarBackground} 100%)`
            : colors.sidebarBackground,
        }}
      >
        <div className="h-1 w-3 rounded-sm" style={{ background: colors.mutedForeground, opacity: 0.45 }} />
        <div className="h-1 w-2.5 rounded-sm" style={{ background: colors.mutedForeground, opacity: 0.3 }} />
        <div className="h-1 w-3 rounded-sm" style={{ background: colors.mutedForeground, opacity: 0.3 }} />
      </div>
      {/* 内容区 */}
      <div
        className="flex flex-1 flex-col gap-1 p-1.5"
        style={{
          background: auto
            ? `linear-gradient(90deg, ${colors.background} 0%, ${colors.background} 55%, ${autoDark.background} 55%, ${autoDark.background} 100%)`
            : glass
              ? `linear-gradient(160deg, color-mix(in srgb, ${accent} 18%, transparent), transparent)`
              : colors.background,
        }}
      >
        <div
          className="h-1 rounded-sm"
          style={{
            background: auto ? `linear-gradient(90deg, ${colors.card} 0%, ${colors.card} 55%, ${autoDark.card} 55%, ${autoDark.card} 100%)` : colors.card,
            boxShadow: `0 0 0 0.0625rem ${colors.border}`,
          }}
        />
        <div
          className="h-1 w-3/4 rounded-sm"
          style={{
            background: auto ? `linear-gradient(90deg, ${colors.card} 0%, ${colors.card} 55%, ${autoDark.card} 55%, ${autoDark.card} 100%)` : colors.card,
            boxShadow: `0 0 0 0.0625rem ${colors.border}`,
          }}
        />
        <div className="h-1 w-1/2 rounded-sm" style={{ background: colorMix(accent, 0.22) }} />
      </div>
    </div>
  )

  return (
    <div
      className="w-full overflow-hidden rounded-md border"
      style={{
        borderColor: colors.border,
        background: glass ? undefined : colors.card,
        boxShadow: `0 0.25rem 0.75rem ${colors.shadowColor}`,
      }}
    >
      {/* 标题栏：三色交通灯（语义色）+ 玻璃底 */}
      <div
        className="flex items-center gap-1 px-2 py-1"
        style={{
          background: glass
            ? `linear-gradient(180deg, color-mix(in srgb, ${colors.card} 55%, transparent), color-mix(in srgb, ${colors.card} 30%, transparent))`
            : colors.card,
          borderBottom: `0.0625rem solid ${colors.border}`,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.semanticRed }} />
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.semanticYellow }} />
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.semanticGreen }} />
      </div>
      {body}
    </div>
  )
}

/** color-mix 单值近似（缩略图内联样式用；rgba 混合主题色） */
function colorMix(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** macOS 风格开关行（标题 + 副标题 + Switch） */
function ToggleRow({
  title,
  desc,
  checked,
  onCheckedChange,
  children,
}: {
  title: string
  desc: string
  checked?: boolean
  onCheckedChange?: (v: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</div>
      </div>
      {children ?? (
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="shrink-0"
          aria-label={title}
        />
      )}
    </div>
  )
}

export default function ThemePanel() {
  const {
    accent,
    appearance,
    isDark,
    isGlass,
    colors,
    setAccent,
    setAppearance,
    accentColors,
    sidebarTint,
    setSidebarTint,
    reduceTransparency,
    setReduceTransparency,
    reduceMotion,
    setReduceMotion,
    fontScale,
    setFontScale,
  } = useTheme()

  // 实时预览用当前派生色（主题切换自动重渲染）
  const sectionTitle = 'mb-2.5 text-[13px] font-semibold text-foreground'
  // 🔴 2026-08-18 自绘取色面板开合
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
      {/* ═══ 外观 — macOS 预览卡片 ═══ */}
      <section>
        <h3 className={sectionTitle}>外观</h3>
        <div className="grid grid-cols-4 gap-2">
          {APPEARANCE_OPTIONS.map(({ value, label, icon }) => {
            const selected = appearance === value
            const light = deriveColors(accent, false)
            const dark = deriveColors(accent, true)
            return (
              <button
                key={value}
                onClick={() => setAppearance(value)}
                className={cn(
                  'group relative flex flex-col items-stretch gap-1.5 rounded-xl border p-2 text-left transition-all duration-150',
                  selected
                    ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/25'
                    : 'border-border/70 bg-card/50 hover:border-primary/30 hover:bg-card'
                )}
                aria-pressed={selected}
              >
                {/* 缩略图：浅色/深色/自动分割/毛玻璃渐变 */}
                {value === 'light' && <WindowMock colors={light} accent={accent} />}
                {value === 'dark' && <WindowMock colors={dark} accent={accent} />}
                {value === 'auto' && <WindowMock colors={light} accent={accent} auto />}
                {value === 'glass' && (
                  <WindowMock
                    colors={isDark ? dark : light}
                    accent={accent}
                    glass
                  />
                )}
                <span className="flex items-center gap-1 px-0.5 text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                  {icon}
                  {label}
                </span>
                {selected && (
                  <span
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full text-background"
                    style={{ background: 'var(--dt-primary)' }}
                  >
                    <Check size={10} strokeWidth={3} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* ═══ 主题色（🔴 2026-08-18 强调色改名；自定义取色改为自绘面板） ═══ */}
      <section>
        <h3 className={sectionTitle}>主题色</h3>
        <div className="relative flex items-center gap-2.5 flex-wrap">
          {accentColors.map(({ name, color }) => {
            const isSelected = accent.toLowerCase() === color.toLowerCase()
            return (
              <button
                key={color}
                onClick={() => setAccent(color)}
                className={cn(
                  'relative grid size-8 place-items-center rounded-full transition-all duration-150',
                  'hover:scale-110 active:scale-95',
                  isSelected
                    ? 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-background'
                    : 'ring-1 ring-black/15'
                )}
                style={{ backgroundColor: color }}
                title={name}
                aria-label={name}
                aria-pressed={isSelected}
              >
                {isSelected && (
                  <Check
                    size={14}
                    strokeWidth={3}
                    // 🔴 2026-08-18 可读色收敛：getReadableOnAccent（原硬编码白/黑）
                    style={{ color: getReadableOnAccent(color) }}
                  />
                )}
              </button>
            )
          })}
          {/* 自定义颜色 — 自绘取色面板（🔴 2026-08-18 替代原生 color input） */}
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className={cn(
              'relative grid size-8 place-items-center rounded-full ring-1 ring-black/15 transition-all duration-150 hover:scale-110 active:scale-95',
              pickerOpen && 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-background'
            )}
            title="自定义颜色"
            aria-label="自定义颜色"
            aria-expanded={pickerOpen}
            style={{ background: RAINBOW_GRADIENT }}
          >
            {!accentColors.some((c) => c.color.toLowerCase() === accent.toLowerCase()) && (
              <Check size={14} strokeWidth={3} style={{ color: '#ffffff' }} />
            )}
          </button>
          {pickerOpen && (
            <ColorPickerPopover
              value={accent}
              onChange={setAccent}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        {/* 当前主题色预览条（渐变，两端淡出） */}
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full flex-1"
            style={{ background: `linear-gradient(90deg, ${colorMix(accent, 0.15)}, ${accent}, ${colorMix(accent, 0.15)})` }}
          />
        </div>
      </section>

      {/* ═══ 边栏色调 + 辅助功能（macOS 分组卡片） ═══ */}
      <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
        <ToggleRow
          title="边栏色调"
          desc="让侧边栏跟随主题色。关闭后侧边栏保持中性灰，换主题色不影响它。"
          checked={sidebarTint}
          onCheckedChange={setSidebarTint}
        />
        <div className="mx-3 h-px bg-border/60" />
        <ToggleRow
          title="降低透明度"
          desc="关闭毛玻璃等半透明效果，改用不透明背景（提升性能与可读性）。"
          checked={reduceTransparency}
          onCheckedChange={setReduceTransparency}
        />
        <div className="mx-3 h-px bg-border/60" />
        <ToggleRow
          title="减弱动态效果"
          desc="关闭动画与过渡，界面状态切换即时呈现。"
          checked={reduceMotion}
          onCheckedChange={setReduceMotion}
        />
        <div className="mx-3 h-px bg-border/60" />
        {/* 文字大小 — 分段控件（macOS 显示器设置 → 文本大小） */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">文字大小</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              调整界面根字号，全应用即时生效。
            </div>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border/70 bg-background/60 p-0.5">
            {FONT_SCALE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFontScale(value)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  fontScale === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={fontScale === value}
              >
                <Type size={11} strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 实时预览 ═══ */}
      <section>
        <h3 className={sectionTitle}>预览</h3>
        <div className="overflow-hidden rounded-xl border border-border/70">
          <WindowMock
            colors={colors}
            accent={accent}
            glass={isGlass}
          />
          <div className="flex items-center justify-between border-t border-border/60 bg-card/40 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              当前：{appearance === 'light' ? '浅色' : appearance === 'dark' ? '深色' : appearance === 'glass' ? '毛玻璃' : '自动'}
              {appearance === 'auto' && (isDark ? '（深色）' : '（浅色）')}
            </span>
            <span className="font-mono">{accent.toUpperCase()}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
