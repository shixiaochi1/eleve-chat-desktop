import { Switch } from '../ui/switch';
import { Power } from 'lucide-react';
import { SectionCard, SettingRow } from './SettingBlocks';

/**
 * SystemSettings — auto-start and general preferences
 *
 * 🔴 2026-08-13 老大指示：默认工作目录设置已移除（减少影响面）——
 * 新会话落点由项目 scope / Agent workspace 决定，不再有进程级默认目录设置。
 *
 * 2026-08-31 卡片 UI 重构：裸表单 → 统一 SectionCard 分组卡片（逻辑不变）。
 */
export default function SystemSettings({
  autoStart,
  setAutoStart,
}: {
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
}) {

  return (
    <div className="max-w-2xl">
      <SectionCard icon={Power} title="常规" desc="应用启动行为">
        <SettingRow label="开机自动启动" desc="登录 Windows 后自动运行 Eleve">
          <Switch
            checked={autoStart}
            onCheckedChange={async (val: boolean) => {
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const result = await invoke('set_auto_start', { enable: val });
                setAutoStart(result as boolean);
              } catch (err) {
                console.error('Failed to set auto-start:', err);
              }
            }}
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
