import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Eye, Code2 } from 'lucide-react';
import * as storage from '../../utils/storage';
import { notifySuccess } from '../../utils/notifications';
import { cn } from '../../lib/utils';

/**
 * AppearanceSettings — 外观主题设置
 *
 * 颜色模式切换: Light / Dark / System
 * Tool Call Display: Product / Technical
 * 桌面主题选择: 6 套预设主题
 */
const THEME_OPTIONS = [
  { id: 'light', label: '浅色', desc: '明亮舒适的日间界面', Icon: Sun },
  { id: 'dark', label: '深色', desc: '护眼沉浸的夜间界面', Icon: Moon },
  { id: 'system', label: '跟随系统', desc: '自动匹配系统外观偏好', Icon: Monitor },
];

const TOOL_DISPLAY_OPTIONS = [
  {
    id: 'product',
    label: 'Product',
    desc: '只显示关键结果，界面简洁',
    Icon: Eye,
  },
  {
    id: 'technical',
    label: 'Technical',
    desc: '显示完整命令和输出详情',
    Icon: Code2,
  },
];

const DESKTOP_THEMES = [
  {
    id: 'default',
    label: 'Default',
    desc: '经典深色主题',
    colors: ['#0a84ff', '#2c2c2e', '#f5f5f7', '#636366'],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    desc: '深蓝色调',
    colors: ['#0077b6', '#023e8a', '#90e0ef', '#caf0f8'],
  },
  {
    id: 'forest',
    label: 'Forest',
    desc: '深绿色调',
    colors: ['#2d6a4f', '#1b4332', '#95d5b2', '#d8f3dc'],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    desc: '暖橙色调',
    colors: ['#e76f51', '#f4a261', '#e9c46a', '#264653'],
  },
  {
    id: 'midnight',
    label: 'Midnight',
    desc: '纯黑色调',
    colors: ['#0a0a0a', '#1a1a1a', '#2a2a2a', '#8a8a8a'],
  },
  {
    id: 'rose',
    label: 'Rose',
    desc: '粉红色调',
    colors: ['#ff6b9d', '#c44569', '#f8a5c2', '#f3d2e1'],
  },
];

export default function AppearanceSettings({ onSaved }: { onSaved?: () => void }) {
  const [theme, setTheme] = useState('system');
  const [toolViewMode, setToolViewMode] = useState(() => storage.load('display.tool_view_mode', 'product') as string);
  const [desktopTheme, setDesktopTheme] = useState(() => storage.load('theme', 'default') as string);

  // 加载已保存的主题
  useEffect(() => {
    const saved = storage.load('theme', 'system') as string;
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const applyTheme = (val: string) => {
    if (val === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    } else {
      document.documentElement.dataset.theme = val;
    }
    // 同时设置 color-scheme 让原生控件适配
    document.documentElement.style.colorScheme = val === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : val;
  };

  // 监听系统主题变化
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') applyTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const handleSelect = (val: string) => {
    setTheme(val);
    applyTheme(val);
    storage.save('theme', val);
    notifySuccess('主题已切换', '外观');
    onSaved?.();
  };

  const handleToolViewMode = (val: string) => {
    setToolViewMode(val);
    storage.save('display.tool_view_mode', val);
    notifySuccess('工具显示模式已切换', '外观');
    onSaved?.();
  };

  const handleDesktopTheme = (val: string) => {
    setDesktopTheme(val);
    storage.save('theme', val);
    document.documentElement.dataset.theme = val;
    notifySuccess(`主题已切换为 ${val}`, '外观');
    onSaved?.();
  };

  return (
    <div>
      {/* 颜色模式 */}
      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3">
        选择界面的颜色方案，即时生效并自动保存。
      </p>

      <div className="flex gap-2.5 mt-1">
        {THEME_OPTIONS.map(({ id, label, desc, Icon }: { id: string; label: string; desc: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }) => {
          const selected = theme === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              className={cn(
                'flex flex-col items-center gap-2 px-2 py-4 rounded-xl cursor-pointer transition-all duration-150 font-ui flex-1',
                selected
                  ? 'border border-accent bg-accent/10 text-accent'
                  : 'border border-border-subtle bg-background text-muted-foreground hover:bg-accent/5'
              )}
            >
              <Icon size={22} strokeWidth={1.5} />
              <span className="text-xs font-semibold">{label}</span>
              <span className="text-[10px] text-muted-foreground/60 leading-tight text-center">
                {desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tool Call Display 区块 */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold text-muted-foreground mb-1">Tool Call Display</h3>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mb-2">选择工具调用的显示模式。</p>
        <div className="flex gap-2.5">
          {TOOL_DISPLAY_OPTIONS.map(({ id, label, desc, Icon }: { id: string; label: string; desc: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }) => {
            const selected = toolViewMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleToolViewMode(id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-all text-xs text-center flex-1',
                  selected
                    ? 'border border-accent bg-accent/10 text-accent'
                    : 'border border-border bg-background text-muted-foreground hover:bg-accent/5'
                )}
              >
                <Icon size={22} strokeWidth={1.5} className="text-muted-foreground" />
                <span className="font-semibold text-xs">{label}</span>
                <span className="text-[10px] text-muted-foreground/60 leading-tight">{desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme 区块 — 桌面主题选择 */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold text-muted-foreground mb-1">Theme</h3>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mb-2">选择桌面主题颜色方案。</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
          {DESKTOP_THEMES.map((t: { id: string; label: string; desc: string; colors: string[] }) => {
            const selected = desktopTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleDesktopTheme(t.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-all text-xs text-center relative',
                  selected
                    ? 'border border-accent bg-accent/10 text-accent'
                    : 'border border-border bg-background text-muted-foreground hover:bg-accent/5'
                )}
              >
                {/* 颜色预览条 */}
                <div className="flex gap-0.5 mb-2 w-full">
                  {t.colors.map((c: string, i: number) => (
                    <div
                      key={i}
                      className="flex-1 h-4 rounded"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <span className="font-semibold text-xs">{t.label}</span>
                <span className="text-[10px] text-muted-foreground/60 leading-tight">{t.desc}</span>
                {selected && (
                  <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
