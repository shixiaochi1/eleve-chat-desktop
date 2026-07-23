import { useState } from 'react';
import { Eye, Code2 } from 'lucide-react';
import * as storage from '../../utils/storage';
import { notifySuccess } from '../../utils/notifications';
import { cn } from '../../lib/utils';

/**
 * AppearanceSettings — 外观设置
 *
 * 只保留工具显示模式（主题选择已移到独立面板）
 */

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

export default function AppearanceSettings({ onSaved }: { onSaved?: () => void }) {
  const [toolViewMode, setToolViewMode] = useState(() => storage.load('display.tool_view_mode', 'product') as string);

  const handleToolViewMode = (val: string) => {
    setToolViewMode(val);
    storage.save('display.tool_view_mode', val);
    notifySuccess('工具显示模式已切换', '外观');
    onSaved?.();
  };

  return (
    <div>
      {/* Tool Call Display 区块 */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-1">Tool Call Display</h3>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mb-2">选择工具调用的显示模式。</p>
        <div className="flex gap-2.5">
          {TOOL_DISPLAY_OPTIONS.map(({ id, label, desc, Icon }) => {
            const selected = toolViewMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleToolViewMode(id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-all text-xs text-center flex-1',
                  selected
                    ? 'border border-primary bg-accent/10 text-primary'
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
    </div>
  );
}
