import { Switch } from '../ui/switch';

/**
 * SystemSettings — auto-start and general preferences
 *
 * 🔴 2026-08-13 老大指示：默认工作目录设置已移除（减少影响面）——
 * 新会话落点由项目 scope / Agent workspace 决定，不再有进程级默认目录设置。
 */
export default function SystemSettings({
  autoStart,
  setAutoStart,
}: {
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
}) {

  return (
    <div>
      {/* 开机自启 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">开机自动启动</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">登录 Windows 后自动运行 Eleve</p>
        </div>
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
      </div>
    </div>
  );
}
