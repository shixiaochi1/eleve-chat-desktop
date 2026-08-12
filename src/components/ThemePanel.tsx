/**
 * ThemePanel — 主题选择 + macOS 强调色调色板
 * 
 * 功能：
 * 1. macOS 强调色调色板 — 一键切换整套配色
 * 2. 预设主题快速切换
 * 3. 高级编辑模式 — 逐变量微调
 */

import { useState } from 'react';
import { useTheme } from '../themes';
import { BUILTIN_THEME_LIST } from '../themes/presets';
import { MACOS_ACCENT_COLORS, DEFAULT_MACOS_ACCENT } from '../themes/macos-accents';
import type { DesktopThemeColors } from '../themes/types';
import { cn } from '@/lib/utils';

interface ThemePanelProps {
  onClose?: () => void;
}

/** 颜色变量分类定义（高级编辑模式用） */
const COLOR_CATEGORIES: {
  name: string;
  description: string;
  colors: { key: keyof DesktopThemeColors; label: string; desc: string }[];
}[] = [
  {
    name: '背景层',
    description: '从深到浅的表面颜色',
    colors: [
      { key: 'background', label: '背板', desc: '最外层环境' },
      { key: 'sidebarBackground', label: '侧边栏', desc: '左侧栏背景' },
      { key: 'card', label: '卡片', desc: '消息区/卡片背景' },
      { key: 'cardForeground', label: '卡片文字', desc: '卡片内文字' },
      { key: 'popover', label: '弹出层', desc: '下拉菜单/对话框' },
    ],
  },
  {
    name: '文字',
    description: '文字颜色层级',
    colors: [
      { key: 'foreground', label: '主文字', desc: '主要文字' },
      { key: 'mutedForeground', label: '次文字', desc: '次要说明文字' },
      { key: 'popoverForeground', label: '弹出层文字', desc: '弹出层内文字' },
    ],
  },
  {
    name: '主色 / 强调',
    description: '品牌色和交互强调色',
    colors: [
      { key: 'primary', label: '主色', desc: '按钮、链接主色' },
      { key: 'primaryForeground', label: '主色文字', desc: '主色按钮上的文字' },
      { key: 'ring', label: '强调色', desc: '选中态、焦点环' },
      { key: 'midground', label: '中间色', desc: '中间色调' },
      { key: 'accent', label: '强调背景', desc: '选中行背景' },
      { key: 'accentForeground', label: '强调文字', desc: '选中行文字' },
    ],
  },
  {
    name: '边框',
    description: '边框和分割线',
    colors: [
      { key: 'border', label: '主边框', desc: '主要分割线' },
      { key: 'sidebarBorder', label: '侧栏边框', desc: '侧边栏边框' },
      { key: 'input', label: '输入框边框', desc: '输入框边框/背景' },
    ],
  },
  {
    name: '交互态',
    description: '鼠标悬停和选中状态',
    colors: [
      { key: 'muted', label: '弱化背景', desc: '禁用/弱化元素' },
      { key: 'secondary', label: '次级背景', desc: '次级元素背景' },
      { key: 'secondaryForeground', label: '次级文字', desc: '次级元素文字' },
    ],
  },
  {
    name: '气泡 / 特殊',
    description: '聊天气泡和特殊元素',
    colors: [
      { key: 'userBubble', label: '用户气泡', desc: '用户消息气泡背景' },
      { key: 'userBubbleBorder', label: '气泡边框', desc: '用户气泡边框' },
      { key: 'destructive', label: '危险色', desc: '删除、错误' },
      { key: 'destructiveForeground', label: '危险文字', desc: '危险按钮文字' },
    ],
  },
];

/**
 * 解析颜色为 {r,g,b}（支持 hex / rgb() / rgba() / color-mix）
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null;
  const c = color.trim();
  if (!c) return null;

  if (c.startsWith('#')) {
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      return {
        r: parseInt(c[1] + c[1], 16),
        g: parseInt(c[2] + c[2], 16),
        b: parseInt(c[3] + c[3], 16),
      };
    }
    if (/^#[0-9a-fA-F]{6}$/.test(c)) {
      return {
        r: parseInt(c.slice(1, 3), 16),
        g: parseInt(c.slice(3, 5), 16),
        b: parseInt(c.slice(5, 7), 16),
      };
    }
    if (/^#[0-9a-fA-F]{8}$/.test(c)) return parseColor(c.slice(0, 7));
    return null;
  }

  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };

  const mix = c.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  if (mix) {
    const parseSide = (s: string): { rgb: { r: number; g: number; b: number } | null; pct: number | null } => {
      const pm = s.match(/^(.*?)\s+([\d.]+)%$/);
      if (pm) return { rgb: parseColor(pm[1].trim()), pct: parseFloat(pm[2]) };
      if (s.trim() === 'transparent') return { rgb: null, pct: null };
      return { rgb: parseColor(s.trim()), pct: null };
    };
    const a = parseSide(mix[1]);
    const b2 = parseSide(mix[2]);
    if (!a.rgb || !b2.rgb) return a.rgb ?? b2.rgb;
    let w1 = a.pct ?? -1;
    let w2 = b2.pct ?? -1;
    if (w1 < 0 && w2 < 0) { w1 = 50; w2 = 50; }
    else if (w1 < 0) w1 = 100 - w2;
    else if (w2 < 0) w2 = 100 - w1;
    const total = w1 + w2;
    return {
      r: Math.round((a.rgb.r * w1 + b2.rgb.r * w2) / total),
      g: Math.round((a.rgb.g * w1 + b2.rgb.g * w2) / total),
      b: Math.round((a.rgb.b * w1 + b2.rgb.b * w2) / total),
    };
  }

  return null;
}

function toHex(color: string): string {
  if (!color) return '#888888';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7);
  const parsed = parseColor(color);
  if (parsed) {
    return `#${[parsed.r, parsed.g, parsed.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#888888';
}

export default function ThemePanel({ onClose }: ThemePanelProps) {
  const { themeName, setTheme, customColors, hasCustomColors, setCustomColor, resetCustomColors, macosAccent, setMacOSAccent } = useTheme();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const currentTheme = BUILTIN_THEME_LIST.find(t => t.name === themeName) ?? BUILTIN_THEME_LIST[0];

  /** 获取当前颜色值 */
  const getColor = (key: keyof DesktopThemeColors): string => {
    const customValue = customColors[key];
    if (customValue) return customValue as string;
    const themeValue = (currentTheme.colors as unknown as Record<string, string>)[key];
    return themeValue ?? '#888888';
  };

  /** 选择预设主题 */
  const handleSelectPreset = (id: string) => {
    setTheme(id);
    resetCustomColors();
    setShowAdvanced(false);
  };

  /** 选择 macOS 强调色 */
  const handleSelectAccent = (color: string) => {
    setMacOSAccent(color);
  };

  /** 重置为预设 */
  const handleReset = () => {
    resetCustomColors();
  };

  return (
    <div className="flex flex-col h-full">
      {/* ═══ macOS 强调色调色板 ═══ */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">强调色</h3>
          <span className="text-[10px] text-muted-foreground">
            选一个颜色，整套配色自动匹配
          </span>
        </div>
        
        {/* 预设强调色圆点 */}
        <div className="flex items-center gap-2 flex-wrap">
          {MACOS_ACCENT_COLORS.map(({ name, color }) => {
            const isSelected = macosAccent.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                onClick={() => handleSelectAccent(color)}
                className={cn(
                  'w-7 h-7 rounded-full transition-all duration-150 relative',
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
                    className="w-3.5 h-3.5 absolute inset-0 m-auto" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke={isLightColor(color) ? '#1d1d1f' : '#ffffff'}
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
          
          {/* 自定义颜色选择器 */}
          <div className="relative">
            <input
              type="color"
              value={toHex(macosAccent)}
              onChange={(e) => handleSelectAccent(e.target.value)}
              className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              title="自定义颜色"
              style={{ 
                borderRadius: '50%',
                overflow: 'hidden',
              }}
            />
          </div>
        </div>

        {/* 当前强调色预览条 */}
        <div className="mt-3 flex items-center gap-2">
          <div 
            className="h-1.5 flex-1 rounded-full" 
            style={{ 
              background: `linear-gradient(90deg, ${macosAccent}20, ${macosAccent}, ${macosAccent}20)` 
            }}
          />
        </div>
      </div>

      {/* ═══ 分隔线 ═══ */}
      <div className="h-px bg-border mb-4" />

      {/* ═══ 预设主题 ═══ */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">预设主题</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {BUILTIN_THEME_LIST.map((t) => {
            const selected = themeName === t.name && !hasCustomColors;
            return (
              <button
                key={t.name}
                onClick={() => handleSelectPreset(t.name)}
                className={cn(
                  'flex flex-col rounded-lg border-2 transition-all relative overflow-hidden',
                  selected
                    ? 'border-primary shadow-sm'
                    : 'border-border hover:border-primary/50'
                )}
              >
                {/* 颜色预览区 */}
                <div className="w-full h-12 flex" style={{ background: t.colors.background }}>
                  <div className="w-1/4 h-full" style={{ background: t.colors.sidebarBackground ?? t.colors.background }} />
                  <div className="flex-1 p-1.5 flex flex-col gap-1">
                    <div className="h-2 rounded" style={{ background: t.colors.card }} />
                    <div className="h-2 rounded w-3/4" style={{ background: t.colors.card }} />
                  </div>
                </div>
                <div className="px-2 py-1.5 text-center">
                  <span className="text-xs font-medium">{t.label}</span>
                </div>
                {selected && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ 高级编辑（折叠） ═══ */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg 
            className={cn('w-3 h-3 transition-transform', showAdvanced && 'rotate-90')} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          高级编辑 — 逐变量微调
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4 max-h-[400px] overflow-y-auto pr-1">
            {COLOR_CATEGORIES.map((category) => (
              <div key={category.name}>
                <h4 className="text-xs font-semibold mb-1">{category.name}</h4>
                <p className="text-[10px] text-muted-foreground mb-2">{category.description}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {category.colors.map(({ key, label, desc }) => {
                    const color = getColor(key);
                    const isCustomized = key in customColors;
                    return (
                      <div
                        key={key}
                        className={cn(
                          'flex items-center gap-1.5 p-1.5 rounded-md border transition-colors',
                          isCustomized
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border bg-background'
                        )}
                      >
                        <input
                          type="color"
                          value={toHex(color)}
                          onChange={(e) => setCustomColor(key, e.target.value)}
                          className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                          title={label}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-medium truncate">
                            {label}
                            {isCustomized && (
                              <span className="ml-1 text-[8px] text-primary">已修改</span>
                            )}
                          </div>
                          <div className="text-[9px] text-muted-foreground truncate">{desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            
            {/* 重置按钮 */}
            {hasCustomColors && (
              <button
                onClick={handleReset}
                className="w-full px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent/50 transition-colors"
              >
                重置为默认
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 判断颜色是否为浅色（用于勾选标记颜色） */
function isLightColor(hex: string): boolean {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}
