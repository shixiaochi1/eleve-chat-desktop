import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { TERMINAL_FONT_SUGGESTIONS, normalizeTerminalFontFamily, setTerminalFontFamily } from '../../lib/terminal-font';


/**
 * WorkspaceSettings — 工作区设置
 *
 * 🔴 2026-08-13 老大指示：工作目录设置已移除（减少影响面）——
 * 新会话/面板目录由项目绑定地址与 Agent workspace 决定，不再有终端默认工作目录配置。
 * 保留：代码执行模式、持久化 Shell、终端字体、文件读取字符上限。
 *
 * 🔴 字段路径对齐后端 Config（信代码实证，消灭顶层死键）：
 * - code_exec_mode → code_execution.mode（取值 project/strict，与后端一致）
 * - persistent_shell → terminal.persistent_shell（对齐 Hermes，主要作用 SSH 后端）
 * - file_read_max_chars → 顶层 file_read_max_chars（字符数，对齐 Hermes，默认 100000）
 */
export default function WorkspaceSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    code_exec_mode: 'project',
    persistent_shell: true,
    file_read_max_chars: 100000,
    terminal_font_family: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const bc = await call('get_config', {});
      const terminal = bc.terminal || {};
      const code_execution = bc.code_execution || {};
      setConfig({
        code_exec_mode: code_execution.mode || 'project',
        persistent_shell: terminal.persistent_shell ?? true,
        file_read_max_chars: bc.file_read_max_chars ?? 100000,
        // 对齐 Hermes terminal.font_family（config.yaml；空 = 默认字体栈）
        terminal_font_family: normalizeTerminalFontFamily(terminal.font_family),
      });
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
    setLoading(false);
  };

  const update = (field: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [field]: value } as typeof prev));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await call('update_config', {
        config: {
          terminal: {
            persistent_shell: config.persistent_shell,
            font_family: normalizeTerminalFontFamily(config.terminal_font_family),
          },
          code_execution: {
            mode: config.code_exec_mode,
          },
          file_read_max_chars: config.file_read_max_chars,
        },
      });
      // 本地状态即时生效（终端热切换，不重启；对齐 Hermes setTerminalFontFamilyFromConfig）
      setTerminalFontFamily(config.terminal_font_family);
      notifySuccess('工作区配置已保存');
      onSaved?.();
    } catch (e) {
      notifyError(e, '保存失败');
    }
    setSaving(false);
  };

  if (loading) return <p className="text-xs text-muted-foreground/70">加载中…</p>;
  if (!loaded) return null;

  return (
    <div>
      {/* 代码执行模式 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">代码执行模式</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.code_exec_mode}
          onChange={e => update('code_exec_mode', e.target.value)}
        >
          <option value="project">project — 项目沙箱内执行</option>
          <option value="strict">strict — 严格隔离模式</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          控制代码执行的环境隔离策略。
        </p>
      </div>

      {/* 持久化 Shell */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">持久化 Shell</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">
            保持 Shell 会话跨轮次不中断（主要作用于远程后端；本地连接默认每轮新建以保证隔离）。
          </p>
        </div>
        <Switch
          checked={config.persistent_shell}
          onCheckedChange={(val: boolean) => update('persistent_shell', val)}
        />
      </div>

      {/* 终端字体（对齐 Hermes terminal.font_family 设置；空 = 默认栈） */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">终端字体</label>
        <Input
          type="text"
          list="terminal-font-suggestions"
          placeholder="JetBrains Mono（空 = 默认）"
          value={config.terminal_font_family}
          onChange={e => update('terminal_font_family', e.target.value)}
        />
        <datalist id="terminal-font-suggestions">
          {TERMINAL_FONT_SUGGESTIONS.map(f => <option key={f} value={f} />)}
        </datalist>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          集成终端字体（支持 Nerd Font，如 MesloLGS NF / JetBrainsMono Nerd Font）。保存后当前终端即时切换，无需重启。
        </p>
      </div>

      {/* 文件读取字符上限 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">文件读取字符上限</label>
        <Input
          type="number"
          className="w-40"
          min={1000}
          max={10000000}
          step={1000}
          value={config.file_read_max_chars}
          onChange={e => update('file_read_max_chars', parseInt(e.target.value) || 100000)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          单次读取文件返回的最大字符数（默认 100000）。
        </p>
      </div>

      {/* 保存按钮 */}
      <div className="mt-4">
        <Button variant="default" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存配置'}
        </Button>
      </div>
    </div>
  );
}
