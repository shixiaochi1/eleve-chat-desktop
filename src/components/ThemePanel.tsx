/**
 * ThemePanel — macOS 风格主题设置（对齐 System Settings → 外观 + 辅助功能）
 *
 * 🔴 2026-08-18 老大需求（两轮）：
 * ① 完善主题系统、macOS 风格面板；
 * ② 强调色 → 主题色；主题色 = **多锚点渐变**——渐变色带上有多个可拖动
 *    锚点（色标），每个锚点控制一个颜色停止点：
 *    - 拖动锚点 → 调整该颜色在渐变中的位置（钳制相邻最小间距）
 *    - 点击色带空白处 → 在当前位置添加锚点（插值当前色，上限 5 个）
 *    - 选中锚点 → 下方展开颜色编辑区（色相/饱和度/亮度滑块 + hex 输入 +
 *      微色板）；双击或删除按钮移除（下限 2 个）
 *    - 派生主色 = 渐变中点（pos 0.5）插值色，旧消费方（accent）自动兼容
 *
 * 外观：浅色/深色/自动/毛玻璃 —— 每个选项带真实派生色的迷你窗口缩略图；
 * 边栏色调 / 降低透明度 / 减弱动态效果 / 文字大小：macOS 辅助功能等价物。
 *
 * 颜色铁律：本组件不允许硬编码色值——卡片/缩略图/滑块轨道/彩虹全部由
 * useTheme().colors、deriveColors()、ACCENT_COLORS、HSL 算法派生。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Sun, Moon, Monitor, Sparkles, Type, Trash2, Plus } from 'lucide-react'
import {
  useTheme,
  deriveColors,
  getReadableOnAccent,
  ACCENT_COLORS,
  normalizeStops,
  gradientColorAt,
  hexToHsl,
  hslToHex,
  GRADIENT_MIN_STOPS,
  GRADIENT_MAX_STOPS,
  GRADIENT_MIN_SPACING,
} from '../themes'
import type { Appearance, DerivedColors, AccentGradient, FontScale } from '../themes/derive'
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

/** 色相轨道彩虹 — HSL 算法生成（h=0..360 标准色序，零硬编码） */
const HUE_TRACK = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360]
  .map((h) => hslToHex(h, 100, 50))
  .join(', ')})`

/** 自定义取色器的彩虹底 — 由 ACCENT_COLORS 派生（macOS 色环同源，零硬编码） */
const RAINBOW_GRADIENT = `conic-gradient(${[
  ...ACCENT_COLORS.map((c) => c.color),
  ACCENT_COLORS[0].color,
].join(', ')})`

// ═══════════════════════════════════════════════════════════════════════════
// 自绘滑块（macOS 风格：细圆角轨道 + 圆钮；点击/拖拽/键盘方向键）
// ═══════════════════════════════════════════════════════════════════════════

function Slider({ value, onChange, track, ariaLabel }: {
  value: number
  onChange: (v: number) => void
  track: string
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const updateFromClientX = useCallback((clientX: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    onChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }, [onChange])

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)}%`}
      tabIndex={0}
      className="theme-slider"
      style={{ background: track }}
      onPointerDown={(e) => {
        draggingRef.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        updateFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) updateFromClientX(e.clientX)
      }}
      onPointerUp={() => { draggingRef.current = false }}
      onPointerCancel={() => { draggingRef.current = false }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.05 : 0.01
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(Math.max(0, value - step))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(Math.min(1, value + step))
        }
      }}
    >
      <span className="theme-slider-thumb" style={{ left: `${value * 100}%` }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 渐变色带锚点编辑器（核心：多锚点滑块控制主题色范围）
// ═══════════════════════════════════════════════════════════════════════════

function GradientBar({ stops, onChange, selected, onSelect }: {
  stops: AccentGradient
  onChange: (stops: AccentGradient) => void
  /** 选中锚点（有序下标；受控，父级 ThemePanel 持有——高亮与颜色编辑区同源） */
  selected: number
  onSelect: (index: number) => void
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  // 排序视图（拖动/渲染统一用排序后的顺序）
  const sorted = useMemo(() => [...stops].sort((a, b) => a.pos - b.pos), [stops])
  const active = Math.min(selected, sorted.length - 1)

  const gradientCss = useMemo(
    () => `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`,
    [sorted],
  )

  const moveStop = useCallback((index: number, pos: number) => {
    const prev = sorted[index - 1]
    const next = sorted[index + 1]
    const min = index === 0 ? 0 : (prev?.pos ?? 0) + GRADIENT_MIN_SPACING
    const max = index === sorted.length - 1 ? 1 : (next?.pos ?? 1) - GRADIENT_MIN_SPACING
    const clamped = Math.min(1, Math.max(0, Math.min(max, Math.max(min, pos))))
    onChange(stops.map((s) => (s === sorted[index] ? { ...s, pos: clamped } : s)))
  }, [sorted, stops, onChange])

  const addStop = useCallback((pos: number) => {
    if (stops.length >= GRADIENT_MAX_STOPS) return
    const added = { pos: Math.min(1, Math.max(0, pos)), color: gradientColorAt(stops, pos) }
    const normalized = normalizeStops([...stops, added])
    onChange(normalized)
    // 选中新锚点：normalize 可能微移位置 → 找离点击位置最近的
    let bestIdx = 0
    let bestDist = Infinity
    normalized.forEach((s, i) => {
      const d = Math.abs(s.pos - added.pos)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    })
    onSelect(bestIdx)
  }, [stops, onChange, onSelect])

  const removeStop = useCallback((index: number) => {
    if (stops.length <= GRADIENT_MIN_STOPS) return
    const target = sorted[index]
    onChange(stops.filter((s) => s !== target))
    onSelect(Math.min(index, stops.length - 2))
  }, [stops, sorted, onChange, onSelect])

  return (
    <div>
      {/* 色带 + 锚点层 */}
      <div
        ref={barRef}
        className="gradient-bar"
        style={{ background: gradientCss }}
        title="点击空白处添加锚点"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.gradient-stop')) return
          const rect = barRef.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          addStop((e.clientX - rect.left) / rect.width)
        }}
      >
        {sorted.map((s, i) => (
          <span
            // key 必须稳定（index）——拖动中 pos/color 每秒多次变化，
            // 用内容作 key 会导致 React 重挂载 → 丢失 pointer capture → 拖不动
            key={i}
            role="slider"
            aria-label={`锚点 ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(s.pos * 100)}
            tabIndex={0}
            className={cn(
              'gradient-stop',
              i === active && 'gradient-stop--active',
              dragIndexRef.current === i && 'gradient-stop--dragging',
            )}
            style={{ left: `${s.pos * 100}%`, background: s.color }}
            title={`${Math.round(s.pos * 100)}% · ${s.color.toUpperCase()}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              dragIndexRef.current = i
              onSelect(i)
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (dragIndexRef.current !== i) return
              const rect = barRef.current?.getBoundingClientRect()
              if (!rect || rect.width <= 0) return
              moveStop(i, (e.clientX - rect.left) / rect.width)
            }}
            onPointerUp={() => { dragIndexRef.current = null }}
            onPointerCancel={() => { dragIndexRef.current = null }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              removeStop(i)
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.05 : 0.01
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault()
                moveStop(i, s.pos - step)
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault()
                moveStop(i, s.pos + step)
              }
            }}
          />
        ))}
      </div>

      {/* 编辑提示 + 添加按钮 */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/70">
          点击色带添加锚点 · 拖动调整范围 · 双击删除
          {stops.length >= GRADIENT_MAX_STOPS && `（已达上限 ${GRADIENT_MAX_STOPS}）`}
        </span>
        <button
          type="button"
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          onClick={() => addStop(0.5)}
          disabled={stops.length >= GRADIENT_MAX_STOPS}
          title="在中间添加锚点"
        >
          <Plus size={10} strokeWidth={2} />
          添加锚点
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 选中锚点的颜色编辑区（HSL 滑块 + hex 输入 + 微色板）
// ═══════════════════════════════════════════════════════════════════════════

function ColorEditor({ color, onChange, onDelete, canDelete }: {
  color: string
  onChange: (color: string) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const [hexDraft, setHexDraft] = useState(color)
  useEffect(() => { setHexDraft(color) }, [color])
  const hsl = useMemo(() => hexToHsl(color), [color])

  const setH = useCallback((t: number) => onChange(hslToHex(Math.round(t * 360), hsl.s, hsl.l)), [hsl, onChange])
  const setS = useCallback((t: number) => onChange(hslToHex(hsl.h, Math.round(t * 100), hsl.l)), [hsl, onChange])
  const setL = useCallback((t: number) => onChange(hslToHex(hsl.h, hsl.s, Math.round(t * 100))), [hsl, onChange])

  const applyHex = useCallback(() => {
    const v = hexDraft.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase())
    else setHexDraft(color)
  }, [hexDraft, color, onChange])

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-background/40 p-2.5">
      {/* 头部：色块预览 + hex 输入 + 删除 */}
      <div className="flex items-center gap-2">
        <span
          className="theme-color-swatch size-6 shrink-0"
          style={{ background: color }}
          aria-hidden
        />
        <div className="flex flex-1 items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground/60">#</span>
          <input
            value={hexDraft.startsWith('#') ? hexDraft.slice(1) : hexDraft}
            onChange={(e) => setHexDraft(`#${e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`)}
            onBlur={applyHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyHex() }
            }}
            className="h-6 w-[76px] rounded border border-border/70 bg-background px-1.5 font-mono text-[11px] uppercase outline-none focus:border-primary/60"
            aria-label="十六进制颜色值"
            spellCheck={false}
          />
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="删除该锚点（双击锚点亦可）"
          >
            <Trash2 size={11} strokeWidth={1.5} />
            删除
          </button>
        )}
      </div>

      {/* HSL 三滑块 */}
      <div className="space-y-1.5">
        <Slider value={hsl.h / 360} onChange={setH} track={HUE_TRACK} ariaLabel="色相" />
        <Slider
          value={hsl.s / 100}
          onChange={setS}
          track={`linear-gradient(90deg, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`}
          ariaLabel="饱和度"
        />
        <Slider
          value={hsl.l / 100}
          onChange={setL}
          track={`linear-gradient(90deg, ${hslToHex(hsl.h, hsl.s, 0)}, ${hslToHex(hsl.h, hsl.s, 50)}, ${hslToHex(hsl.h, hsl.s, 100)})`}
          ariaLabel="亮度"
        />
      </div>

      {/* 微色板（macOS 预设） */}
      <div className="flex items-center gap-1.5">
        {ACCENT_COLORS.map(({ name, color: c }) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              'size-4 rounded-full transition-transform duration-100 hover:scale-110',
              c.toLowerCase() === color.toLowerCase() && 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background',
            )}
            style={{ background: c }}
            title={name}
            aria-label={name}
          />
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 迷你窗口缩略图（外观预览卡片）
// ═══════════════════════════════════════════════════════════════════════════

function WindowMock({ colors, accent, glass, auto }: { colors: DerivedColors; accent: string; glass?: boolean; auto?: boolean }) {
  const autoDark = auto ? deriveColors(accent, true) : colors
  const body = (
    <div className="flex" style={{ height: 52 }}>
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

// ═══════════════════════════════════════════════════════════════════════════
// 主面板
// ═══════════════════════════════════════════════════════════════════════════

export default function ThemePanel() {
  const {
    accent,
    accentGradient,
    appearance,
    isDark,
    isGlass,
    colors,
    setAccentGradient,
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

  const sectionTitle = 'mb-2.5 text-[13px] font-semibold text-foreground'

  // 渐变色带锚点（有序视图 + 编辑回调）
  const stops = useMemo(() => [...accentGradient].sort((a, b) => a.pos - b.pos), [accentGradient])
  const updateGradient = useCallback((next: AccentGradient) => {
    setAccentGradient(normalizeStops(next))
  }, [setAccentGradient])
  const pickPreset = useCallback((color: string) => {
    setAccentGradient([
      { pos: 0, color },
      { pos: 1, color },
    ])
    setEditingIndex(0)
  }, [setAccentGradient])

  const [editingIndex, setEditingIndex] = useState<number | null>(0)
  const activeIndex = editingIndex !== null ? Math.min(editingIndex, stops.length - 1) : null

  const editStopColor = useCallback((index: number, color: string) => {
    updateGradient(stops.map((s, i) => (i === index ? { ...s, color } : s)))
  }, [stops, updateGradient])

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
                {value === 'light' && <WindowMock colors={light} accent={accent} />}
                {value === 'dark' && <WindowMock colors={dark} accent={accent} />}
                {value === 'auto' && <WindowMock colors={light} accent={accent} auto />}
                {value === 'glass' && <WindowMock colors={isDark ? dark : light} accent={accent} glass />}
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

      {/* ═══ 主题色 — 预设 + 多锚点渐变色带（🔴 2026-08-18 重做） ═══ */}
      <section>
        <h3 className={sectionTitle}>主题色</h3>

        {/* 预设圆点行（macOS 标准 8 色 + 自定义） */}
        <div className="mb-2.5 flex items-center gap-2.5 flex-wrap">
          {accentColors.map(({ name, color }) => {
            const isSelected = stops.every((s) => s.color.toLowerCase() === color.toLowerCase())
            return (
              <button
                key={color}
                type="button"
                onClick={() => pickPreset(color)}
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
                  <Check size={14} strokeWidth={3} style={{ color: getReadableOnAccent(color) }} />
                )}
              </button>
            )
          })}
          {/* 自定义取色器（彩虹底由 ACCENT_COLORS 派生） */}
          <label
            className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full ring-1 ring-black/15 transition-transform duration-150 hover:scale-110"
            title="自定义颜色"
            style={{ background: RAINBOW_GRADIENT }}
          >
            <input
              type="color"
              value={accent}
              onChange={(e) => pickPreset(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label="自定义颜色"
            />
            {!accentColors.some((c) => c.color.toLowerCase() === accent.toLowerCase()) && (
              <Check size={14} strokeWidth={3} style={{ color: '#ffffff' }} />
            )}
          </label>
        </div>

        {/* 多锚点渐变色带编辑器（选中态受控：高亮 + 编辑区同源） */}
        <GradientBar
          stops={stops}
          onChange={updateGradient}
          selected={activeIndex ?? 0}
          onSelect={setEditingIndex}
        />

        {/* 选中锚点颜色编辑区 */}
        {activeIndex !== null && (
          <ColorEditor
            color={stops[activeIndex].color}
            onChange={(color) => editStopColor(activeIndex, color)}
            onDelete={() => {
              if (stops.length <= GRADIENT_MIN_STOPS) return
              updateGradient(stops.filter((_, i) => i !== activeIndex))
              setEditingIndex(null)
            }}
            canDelete={stops.length > GRADIENT_MIN_STOPS}
          />
        )}

        {/* 当前主题色预览条（渐变 + 主色读数） */}
        <div className="mt-3 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})` }}
          />
          <span className="font-mono text-[10px] text-muted-foreground/70" title="渐变中点色（派生主色）">
            {accent.toUpperCase()}
          </span>
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
        {/* 文字大小 — 分段控件 */}
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
          <WindowMock colors={colors} accent={accent} glass={isGlass} />
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
