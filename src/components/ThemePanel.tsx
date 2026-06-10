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
import { useTheme } from '../themes';
import { BUILTIN_THEME_LIST } from '../themes/presets';
import type { DesktopThemeColors } from '../themes/types';
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

/** 简化颜色值为 hex（用于 color input） */
function toHex(color: string): string {
  if (!color) return '#888888';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7); // rgba hex -> rgb hex
  // 对于 color-mix 或 rgba()，返回默认
  return '#888888';
}

export default function ThemePanel({ onClose }: ThemePanelProps) {
  const { themeName, setTheme, customColors, hasCustomColors, setCustomColor, resetCustomColors } = useTheme();
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
              const isDark = t.colors.background.startsWith('#') &&
                parseInt(t.colors.background.slice(1), 16) < 0x808080;
              return (
                <div
                  key={t.name}
                  className={cn(
                    'flex flex-col rounded-xl border-2 transition-all relative overflow-hidden',
                    selected
                      ? 'border-primary shadow-md'
                      : 'border-border hover:border-accent'
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
                      <span className="text-[10px] text-muted-foreground/60 ml-1.5">
                        {isDark ? '深色' : '浅色'}
                      </span>
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
    </div>
  );
}
