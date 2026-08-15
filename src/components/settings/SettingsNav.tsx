import { Shield, Zap, Lock, Power, FolderOpen, Brain, Wrench, Plug, MessageCircle, ShieldCheck, Mic, Network, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

const SETTINGS_SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'providers', label: '服务商', icon: Shield },
  { id: 'models', label: '模型', icon: Zap },
  { id: 'workspace', label: '工作区', icon: FolderOpen },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'chat', label: '聊天', icon: MessageCircle },
  { id: 'safety', label: '安全防护', icon: ShieldCheck },
  { id: 'voice', label: '语音', icon: Mic },
  { id: 'mcp', label: 'MCP', icon: Plug },
  // 🔴 2026-08-10 网关功能已搬入 LOGO 面板（GatewayPanel），设置里移除重复入口
  { id: 'connection', label: '连接', icon: Network },
  { id: 'security', label: '密钥安全', icon: Lock },
  { id: 'advanced', label: '高级', icon: Wrench },
  { id: 'system', label: '系统', icon: Power },
];

export default function SettingsNav({ activeSection, onSectionChange }: { activeSection: string; onSectionChange: (id: string) => void }) {
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {SETTINGS_SECTIONS.map(s => {
        const Icon = s.icon;
        const isActive = activeSection === s.id;
        return (
          <button
            key={s.id}
            className={cn(
              "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm text-left transition-colors",
              isActive
                ? "bg-[var(--theme-accent)] text-[var(--theme-accent-foreground)] font-medium"
                : "text-[var(--theme-muted-foreground)] hover:bg-[var(--theme-accent)]/20 hover:text-[var(--theme-foreground)]"
            )}
            onClick={() => onSectionChange(s.id)}
            type="button"
          >
            <Icon size={16} strokeWidth={1.5} />
            <span>{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
