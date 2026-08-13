/**
 * ThemePanel — macOS 风格主题设置
 * 
 * 只有两个控制项：
 * 1. 外观模式：Light / Dark / Auto / Glass
 * 2. 主题色：8 个预设 + 自定义
 */

import { useTheme, isDarkColor } from '../themes'
import type { Appearance } from '../themes/derive'
import { cn } from '@/lib/utils'

const APPEARANCE_OPTIONS: { value: Appearance; label: string; desc: string }[] = [
  { value: 'light', label: '浅色', desc: '始终使用浅色模式' },
  { value: 'dark', label: '深色', desc: '始终使用深色模式' },
  { value: 'auto', label: '自动', desc: '跟随系统设置' },
  { value: 'glass', label: '毛玻璃', desc: '半透明玻璃效果' },
]

export default function ThemePanel() {
  const { accent, appearance, isDark, colors, setAccent, setAppearance, accentColors } = useTheme()

  return (
    <div className="flex flex-col h-full">
      {/* ═══ 外观模式 ═══ */}
      <div className="mb-5">
        <h3 className="text-sm font-semibold mb-3">外观</h3>
        <div className="grid grid-cols-2 gap-2">
          {APPEARANCE_OPTIONS.map(({ value, label, desc }) => {
            const selected = appearance === value
            return (
              <button
                key={value}
                onClick={() => setAppearance(value)}
                className={cn(
                  'flex flex-col items-start p-3 rounded-lg border-2 transition-all text-left',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                )}
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══ 分隔线 ═══ */}
      <div className="h-px bg-border mb-5" />

      {/* ═══ 主题色 ═══ */}
      <div className="mb-5">
        <h3 className="text-sm font-semibold mb-3">主题色</h3>
        
        {/* 预设主题色圆点 */}
        <div className="flex items-center gap-3 flex-wrap">
          {accentColors.map(({ name, color }) => {
            const isSelected = accent.toLowerCase() === color.toLowerCase()
            return (
              <button
                key={color}
                onClick={() => setAccent(color)}
                className={cn(
                  'w-8 h-8 rounded-full transition-all duration-150 relative',
                  'hover:scale-110 active:scale-95',
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/30 scale-105'
                    : 'ring-1 ring-black/10'
                )}
                style={{ backgroundColor: color }}
                title={name}
                aria-label={name}
              >
                {isSelected && (
                  <svg 
                    className="w-4 h-4 absolute inset-0 m-auto" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke={isDarkColor(color) ? '#ffffff' : '#1d1d1f'}
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
          
          {/* 自定义颜色选择器 */}
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="w-8 h-8 rounded-full cursor-pointer"
            title="自定义颜色"
          />
        </div>

        {/* 当前主题色预览条 */}
        <div className="mt-4 flex items-center gap-2">
          <div 
            className="h-2 flex-1 rounded-full" 
            style={{ 
              background: `linear-gradient(90deg, ${accent}20, ${accent}, ${accent}20)` 
            }}
          />
        </div>
      </div>

      {/* ═══ 实时预览 ═══ */}
      <div className="mt-auto pt-4 border-t border-border">
        <h3 className="text-xs font-semibold mb-2 text-muted-foreground">预览</h3>
        <div className="rounded-lg overflow-hidden border border-border">
          {/* 模拟界面 — 使用真实派生色 */}
          <div className="flex h-24" style={{ background: colors.background }}>
            {/* 侧边栏 */}
            <div 
              className="w-1/4 h-full flex flex-col items-center pt-2 gap-1"
              style={{ background: colors.sidebarBackground }}
            >
              <div className="w-3 h-3 rounded" style={{ background: accent }} />
              <div className="w-4 h-0.5 rounded" style={{ background: colors.mutedForeground, opacity: 0.3 }} />
              <div className="w-4 h-0.5 rounded" style={{ background: colors.mutedForeground, opacity: 0.3 }} />
            </div>
            {/* 内容区 */}
            <div className="flex-1 p-2 flex flex-col gap-1.5">
              <div className="h-3 rounded" style={{ background: colors.card }} />
              <div className="h-3 rounded w-3/4" style={{ background: colors.card }} />
              <div className="h-3 rounded w-1/2" style={{ background: colors.card }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
