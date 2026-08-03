/**
 * ThemePanel — 主题选择 + 自定义编辑器
 * 
 * 功能：
 * 1. 7 套预设主题快速切换
 * 2. 点击"编辑"进入颜色编辑模式
 * 3. 颜色按组件分类展示，每个变量有颜色选择器
 * 4. 实时预览 + 保存自定义颜色
 */

import { useState } from 'react';
import { Eye, Code2 } from 'lucide-react';
import { useTheme } from '../themes';
import { BUILTIN_THEME_LIST } from '../themes/presets';
import type { DesktopThemeColors } from '../themes/types';
import { useToolViewMode, setToolViewMode, type ToolViewMode } from '@/store/tool-view';
import { cn } from '@/lib/utils';

interface ThemePanelProps {
  onClose?: () => void;
}

/** 颜色变量分类定义 */
const COLOR_CATEGORIES: {
  name: string;
  description: string;
  colors: { key: keyof DesktopThemeColors; label: string; desc: string }[];
}[] = [
  {
    name: '背景层',
    description: '从深到浅的表面颜色',
    colors: [
      { key: 'background', label: '背板', desc: '最外层背景' },
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
 * 解析颜色为 {r,g,b}（支持 hex / rgb() / rgba() / color-mix(in srgb, ...) 递归）
 * 仅用于 color input 显示预览——编辑器里的色块要展示真实混合结果，不能回退灰块
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null;
  const c = color.trim();
  if (!c) return null;

  // hex（#rgb / #rrggbb / #rrggbbaa → 丢 alpha）
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

  // rgb() / rgba()（丢 alpha）
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };

  // color-mix(in srgb, <c1> <p1>%, <c2> <p2>%)
  // 权重规则（CSS 语义）：双百分比归一化；单百分比另一色补足；无百分比 50/50
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
    // transparent 参与 → color input 不支持 alpha，诚实降级返回另一色
    if (!a.rgb || !b2.rgb) return a.rgb ?? b2.rgb;
    // -1 哨兵 = 未指定百分比（TS 收窄友好；CSS 语义：单百分比另一色补足，无百分比 50/50）
    let w1 = a.pct ?? -1;
    let w2 = b2.pct ?? -1;
    if (w1 < 0 && w2 < 0) {
      w1 = 50;
      w2 = 50;
    } else if (w1 < 0) {
      w1 = 100 - w2;
    } else if (w2 < 0) {
      w2 = 100 - w1;
    }
    const total = w1 + w2;
    return {
      r: Math.round((a.rgb.r * w1 + b2.rgb.r * w2) / total),
      g: Math.round((a.rgb.g * w1 + b2.rgb.g * w2) / total),
      b: Math.round((a.rgb.b * w1 + b2.rgb.b * w2) / total),
    };
  }

  return null;
}

/** 简化颜色值为 hex（用于 color input）— color-mix/rgba 解析为真实混合色，不再一律回退 #888888 */
function toHex(color: string): string {
  if (!color) return '#888888';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7); // rgba hex -> rgb hex
  const parsed = parseColor(color);
  if (parsed) {
    return `#${[parsed.r, parsed.g, parsed.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#888888';
}

/** 工具调用显示模式选项（对齐 Hermes appearance-settings toolView 文案） */
const TOOL_VIEW_OPTIONS: { id: ToolViewMode; label: string; desc: string; Icon: typeof Eye }[] = [
  { id: 'product', label: '产品', desc: '易读的工具活动与简洁摘要', Icon: Eye },
  { id: 'technical', label: '技术', desc: '包含原始工具参数/结果及底层细节', Icon: Code2 },
];

export default function ThemePanel({ onClose }: ThemePanelProps) {
  const { themeName, setTheme, customColors, hasCustomColors, setCustomColor, resetCustomColors } = useTheme();
  const toolViewMode = useToolViewMode();
  const [isEditing, setIsEditing] = useState(false);

  const currentTheme = BUILTIN_THEME_LIST.find(t => t.name === themeName) ?? BUILTIN_THEME_LIST[0];

  /** 获取当前颜色值（自定义覆盖 > 预设） */
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
    setIsEditing(false);
  };

  /** 进入编辑模式 */
  const handleStartEdit = (themeId?: string) => {
    if (themeId && themeId !== themeName) {
      setTheme(themeId);
    }
    setIsEditing(true);
  };

  /** 退出编辑模式 */
  const handleStopEdit = () => {
    setIsEditing(false);
  };

  /** 重置为预设 */
  const handleReset = () => {
    resetCustomColors();
  };

  return (
    <div className="flex flex-col h-full">
      {/* 标题区 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {isEditing
              ? `正在编辑「${currentTheme.label}」主题颜色`
              : '选择主题，或点击编辑自定义颜色'}
          </p>
        </div>
        {isEditing && (
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent/50 transition-colors"
            >
              重置为预设
            </button>
            <button
              onClick={handleStopEdit}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-colors"
            >
              完成
            </button>
          </div>
        )}
      </div>

      {/* 编辑模式：颜色选择器 */}
      {isEditing ? (
        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {COLOR_CATEGORIES.map((category) => (
            <div key={category.name}>
              <h3 className="text-sm font-semibold mb-1">{category.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">{category.description}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {category.colors.map(({ key, label, desc }) => {
                  const color = getColor(key);
                  const isCustomized = key in customColors;
                  return (
                    <div
                      key={key}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-lg border transition-colors',
                        isCustomized
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background'
                      )}
                    >
                      <input
                        type="color"
                        value={toHex(color)}
                        onChange={(e) => setCustomColor(key, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                        title={label}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {label}
                          {isCustomized && (
                            <span className="ml-1 text-[9px] text-primary">已修改</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 选择模式：主题卡片 */
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {BUILTIN_THEME_LIST.map((t) => {
              const selected = themeName === t.name;
              return (
                <div
                  key={t.name}
                  className={cn(
                    'flex flex-col rounded-xl border-2 transition-all relative overflow-hidden',
                    selected
                      ? 'border-primary shadow-md'
                      : 'border-border hover:border-primary'
                  )}
                >
                  {/* 颜色预览区 */}
                  <div className="w-full h-24 flex" style={{ background: t.colors.background }}>
                    {/* 左侧栏 */}
                    <div className="w-1/4 h-full flex flex-col items-center pt-2 gap-1" style={{ background: t.colors.sidebarBackground ?? t.colors.background }}>
                      <div className="w-3 h-3 rounded" style={{ background: t.colors.primary }} />
                      <div className="w-4 h-0.5 rounded" style={{ background: t.colors.foreground, opacity: 0.3 }} />
                      <div className="w-4 h-0.5 rounded" style={{ background: t.colors.foreground, opacity: 0.3 }} />
                      <div className="w-4 h-0.5 rounded" style={{ background: t.colors.foreground, opacity: 0.3 }} />
                    </div>
                    {/* 右侧内容区 */}
                    <div className="flex-1 p-2 flex flex-col gap-1.5">
                      <div className="h-3 rounded" style={{ background: t.colors.card }} />
                      <div className="h-3 rounded w-3/4" style={{ background: t.colors.card }} />
                      <div className="h-3 rounded w-1/2" style={{ background: t.colors.card }} />
                    </div>
                  </div>

                  {/* 主题信息 + 按钮 */}
                  <div className="p-3 flex flex-col gap-2">
                    <div className="text-center">
                      <span className="font-semibold text-sm">{t.label}</span>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleSelectPreset(t.name)}
                        className={cn(
                          'flex-1 px-2 py-1.5 text-xs rounded-md transition-colors',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-accent/50 hover:bg-accent text-foreground'
                        )}
                      >
                        {selected ? '使用中' : '使用'}
                      </button>
                      <button
                        onClick={() => handleStartEdit(t.name)}
                        className="px-2 py-1.5 text-xs rounded-md border border-border hover:bg-accent/50 transition-colors"
                        title="编辑颜色"
                      >
                        编辑
                      </button>
                    </div>
                  </div>

                  {/* 选中指示器 */}
                  {selected && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-sm">
                      <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  {/* 自定义标记 */}
                  {selected && hasCustomColors && (
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] bg-primary/80 text-primary-foreground">
                      已定制
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 工具调用显示模式（外观合并至此 — 对齐 Hermes appearance-settings toolView 区块） */}
      <div className="shrink-0 border-t border-border pt-3 mt-4">
        <h3 className="text-sm font-semibold">工具调用显示</h3>
        <p className="text-xs text-muted-foreground mb-2">产品模式隐藏原始工具数据；技术模式显示完整输入/输出。</p>
        <div className="flex gap-2.5">
          {TOOL_VIEW_OPTIONS.map(({ id, label, desc, Icon }) => {
            const selected = toolViewMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setToolViewMode(id)}
                className={cn(
                  'flex flex-col items-center gap-1 p-2.5 rounded-lg cursor-pointer transition-all text-xs text-center flex-1',
                  selected
                    ? 'border border-primary bg-accent/10 text-primary'
                    : 'border border-border bg-background text-muted-foreground hover:bg-accent/5'
                )}
              >
                <Icon size={18} strokeWidth={1.5} className={selected ? 'text-primary' : 'text-muted-foreground'} />
                <span className="font-semibold">{label}</span>
                <span className="text-[10px] text-muted-foreground/70 leading-tight">{desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
