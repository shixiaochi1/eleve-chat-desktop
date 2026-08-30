import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Terminal } from 'lucide-react';
import { SectionCard, SettingRow, SettingField, SettingsSaveBar } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';
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
 *
 * 2026-08-31 卡片 UI 重构：裸表单 → 统一 SectionCard 分组卡片（逻辑不变）。
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
    <div className="max-w-2xl">
      {/* 代码执行与终端 */}
      <SectionCard icon={Terminal} title="代码执行与终端" desc="执行环境隔离与终端行为">
        <SettingField label="代码执行模式" desc="控制代码执行的环境隔离策略。">
          <select
            className={selectCls}
            value={config.code_exec_mode}
            onChange={e => update('code_exec_mode', e.target.value)}
          >
            <option value="project">project — 项目沙箱内执行</option>
            <option value="strict">strict — 严格隔离模式</option>
          </select>
        </SettingField>
        <SettingRow label="持久化 Shell" desc="保持 Shell 会话跨轮次不中断（主要作用于远程后端；本地连接默认每轮新建以保证隔离）。">
          <Switch
            checked={config.persistent_shell}
            onCheckedChange={(val: boolean) => update('persistent_shell', val)}
          />
        </SettingRow>
        <SettingField label="终端字体" desc="集成终端字体（支持 Nerd Font，如 MesloLGS NF / JetBrainsMono Nerd Font）。保存后当前终端即时切换，无需重启。">
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
        </SettingField>
        <SettingField label="文件读取字符上限" desc="单次读取文件返回的最大字符数（默认 100000）。">
          <Input
            type="number"
            className="w-40"
            min={1000}
            max={10000000}
            step={1000}
            value={config.file_read_max_chars}
            onChange={e => update('file_read_max_chars', parseInt(e.target.value) || 100000)}
          />
        </SettingField>
      </SectionCard>

      {/* 保存按钮 */}
      <SettingsSaveBar>
        <Button variant="default" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存配置'}
        </Button>
      </SettingsSaveBar>
    </div>
  );
}
