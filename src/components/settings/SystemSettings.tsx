import { useEffect, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { Switch } from '../ui/switch';
import { isDesktop } from '../../utils/bridge';
import { loadSettings, saveSettings, isSettingsReady } from '../../utils/settings-store';
import { notifySuccess, notifyError } from '../../utils/notifications';

/**
 * SystemSettings — auto-start and general preferences
 *
 * 默认工作目录（W-2 补写入方）：
 * - 进程级设置，写 settings.json 的 default_project_dir 字段
 * - Tauri 壳启动 eleved 时读取（resolve_eleve_cwd → spawn cwd + TERMINAL_CWD）
 * - 与 per-Agent 的 config.yaml terminal.cwd（工作区设置）分层：
 *   本字段 = 后端进程 cwd 种子；terminal.cwd = 会话 cwd 覆盖
 * - 重启后端服务后生效（托管重启会重新执行 resolve_eleve_cwd）
 */
export default function SystemSettings({
  autoStart,
  setAutoStart,
}: {
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
}) {
  const desktop = isDesktop();
  const [defaultDir, setDefaultDir] = useState<string>(() => loadSettings().default_project_dir ?? '');

  // settings 可能在 mount 后才从后端加载完成 → ready 后补读一次
  useEffect(() => {
    if (isSettingsReady()) return;
    const timer = setInterval(() => {
      if (isSettingsReady()) {
        setDefaultDir(loadSettings().default_project_dir ?? '');
        clearInterval(timer);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const handlePick = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const sel = await open({ directory: true, multiple: false, title: '选择默认工作目录' });
      const path = Array.isArray(sel) ? (sel[0] ?? null) : sel;
      if (!path) return;
      await saveSettings({ ...loadSettings(), default_project_dir: path });
      setDefaultDir(path);
      notifySuccess('默认工作目录已保存，重启后端服务后生效');
    } catch (err) {
      notifyError(err, '设置默认工作目录失败');
    }
  };

  const handleClear = async () => {
    try {
      const next = { ...loadSettings() };
      delete next.default_project_dir;
      await saveSettings(next);
      setDefaultDir('');
      notifySuccess('已清除默认工作目录，重启后端服务后生效');
    } catch (err) {
      notifyError(err, '清除默认工作目录失败');
    }
  };

  return (
    <div>
      {/* 开机自启 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">开机自动启动</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">登录 Windows 后自动运行 Eleve Chat</p>
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

      {/* 默认工作目录（仅桌面端） */}
      {desktop && (
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="min-w-0">
            <label className="block text-xs text-muted-foreground mb-0.5">默认工作目录</label>
            <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">
              新会话的默认工作目录（对齐 Hermes：未指定其它目录时在此启动；留空回退到用户主目录）。
              仅当 Agent 工作区设置未配置 CWD 且会话无烙印时生效——重启后端服务后生效。
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 max-w-[45%]">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs text-foreground/80 hover:bg-accent transition-colors min-w-0"
              onClick={handlePick}
              title={defaultDir || '选择默认工作目录'}
            >
              <FolderOpen size={12} className="text-warning shrink-0" />
              <span className="truncate">{defaultDir || '未设置（用户主目录）'}</span>
            </button>
            {defaultDir && (
              <button
                className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                onClick={handleClear}
                title="清除（回退到用户主目录）"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
