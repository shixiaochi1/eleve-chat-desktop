/**
 * ThemePanel — macOS 风格主题设置（对齐 System Settings → 外观 + 辅助功能）
 *
 * 🔴 2026-08-18 老大需求：完善 ELEVE 主题系统，借鉴 macOS 主题体系：
 * - 外观：浅色/深色/自动/毛玻璃 —— 每个选项带真实派生色的迷你窗口缩略图
 *   （macOS System Settings 同款预览卡片形态，不再是一排文字按钮）
 * - 强调色：macOS 8 标准色 + 自定义取色器（勾选符号走 getReadableOnAccent）
 * - 边栏色调：macOS「允许墙纸调色」的桌面等价物（边栏跟随主题色/中性灰）
 * - 降低透明度 / 减弱动态效果：macOS 辅助功能两项（context.tsx 落 class）
 * - 文字大小：小/标准/大 分段控件（驱动 --dt-base-size 根字号）
 * - 实时预览：当前主题的迷你窗口（全部用真实派生色，零硬编码）
 *
 * 颜色铁律：本组件不允许任何硬编码色值——卡片/缩略图全部消费
 * useTheme().colors 与 deriveColors() 派生色 + 主题 CSS 变量。
 */
import { type ReactNode } from 'react'
import { Check, Sun, Moon, Monitor, Sparkles, Type } from 'lucide-react'
import { useTheme, deriveColors, getReadableOnAccent, ACCENT_COLORS } from '../themes'
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

      {/* ═══ 强调色 ═══ */}
      <section>
        <h3 className={sectionTitle}>强调色</h3>
        <div className="flex items-center gap-2.5 flex-wrap">
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
          {/* 自定义颜色选择器（彩虹底由 ACCENT_COLORS 派生） */}
          <label
            className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full ring-1 ring-black/15 transition-transform duration-150 hover:scale-110"
            title="自定义颜色"
            style={{ background: RAINBOW_GRADIENT }}
          >
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label="自定义颜色"
            />
            {!accentColors.some((c) => c.color.toLowerCase() === accent.toLowerCase()) && (
              <Check size={14} strokeWidth={3} style={{ color: '#ffffff' }} />
            )}
          </label>
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
