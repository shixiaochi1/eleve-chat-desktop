import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * SafetySettings — 安全设置
 *
 * 审批模式、命令白名单、隐私保护、浏览器安全、检查点
 */
export default function SafetySettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    approvals_mode: 'manual',
    approvals_timeout: 60,
    mcp_reload_confirm: true,
    command_allowlist: '',
    redact_secrets: true,
    allow_private_urls_security: false,
    allow_private_urls_browser: false,
    auto_local_for_private_urls: false,
    checkpoints_enabled: true,
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
      const approvals = bc.approvals || {};
      const security = bc.security || {};
      const browser = bc.browser || {};
      const checkpoints = bc.checkpoints || {};

      setConfig({
        approvals_mode: approvals.mode || 'manual',
        approvals_timeout: approvals.timeout ?? 60,
        mcp_reload_confirm: approvals.mcp_reload_confirm ?? true,
        command_allowlist: (Array.isArray(approvals.command_allowlist) ? approvals.command_allowlist.join(', ') : approvals.command_allowlist || ''),
        redact_secrets: security.redact_secrets ?? true,
        allow_private_urls_security: security.allow_private_urls ?? false,
        allow_private_urls_browser: browser.allow_private_urls ?? false,
        auto_local_for_private_urls: browser.auto_local_for_private_urls ?? false,
        checkpoints_enabled: checkpoints.enabled ?? true,
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
          approvals: {
            mode: config.approvals_mode,
            timeout: config.approvals_timeout,
            mcp_reload_confirm: config.mcp_reload_confirm,
            command_allowlist: config.command_allowlist
              ? config.command_allowlist.split(',').map((s: string) => s.trim()).filter(Boolean)
              : undefined,
          },
          security: {
            redact_secrets: config.redact_secrets,
            allow_private_urls: config.allow_private_urls_security,
          },
          browser: {
            allow_private_urls: config.allow_private_urls_browser,
            auto_local_for_private_urls: config.auto_local_for_private_urls,
          },
          checkpoints: {
            enabled: config.checkpoints_enabled,
          },
        },
      });
      notifySuccess('安全配置已保存');
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
      {/* ══════════ 审批设置 ══════════ */}
      <h3 className="text-sm font-medium mb-3">审批设置</h3>

      {/* 审批模式 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">审批模式</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.approvals_mode}
          onChange={e => update('approvals_mode', e.target.value)}
        >
          <option value="manual">manual — 手动审批</option>
          <option value="smart">smart — 智能审批</option>
          <option value="off">off — 关闭审批</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          控制工具调用是否需要用户审批。smart 模式下低风险操作自动放行。
        </p>
      </div>

      {/* 审批超时 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">审批超时（秒）</label>
        <Input
          type="number"
          min={5}
          max={600}
          step={5}
          value={config.approvals_timeout}
          onChange={e => update('approvals_timeout', parseInt(e.target.value) || 60)}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          待审批操作的超时时间。超时后操作将自动拒绝（默认 60 秒）。
        </p>
      </div>

      {/* MCP 重载确认 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">MCP 重载确认</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">重载 MCP 服务器前需要用户确认。</p>
        </div>
        <Switch
          checked={config.mcp_reload_confirm}
          onCheckedChange={(val: boolean) => update('mcp_reload_confirm', val)}
        />
      </div>

      {/* 命令白名单 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">命令白名单</label>
        <Input
          type="text"
          placeholder="例如: git, npm, curl"
          value={config.command_allowlist}
          onChange={e => update('command_allowlist', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          逗号分隔的允许执行命令列表。留空表示所有命令均需审批。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 隐私与安全 ══════════ */}
      <h3 className="text-sm font-medium mb-3">隐私与安全</h3>

      {/* 隐藏敏感信息 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">隐藏敏感信息</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">在日志和界面中隐藏 API Key 等敏感信息。</p>
        </div>
        <Switch
          checked={config.redact_secrets}
          onCheckedChange={(val: boolean) => update('redact_secrets', val)}
        />
      </div>

      {/* 允许私有 URL（安全） */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">允许私有 URL（安全）</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">Agent 可访问内网 / 本地地址（安全检查层面）。</p>
        </div>
        <Switch
          checked={config.allow_private_urls_security}
          onCheckedChange={(val: boolean) => update('allow_private_urls_security', val)}
        />
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 浏览器安全 ══════════ */}
      <h3 className="text-sm font-medium mb-3">浏览器安全</h3>

      {/* 浏览器允许私有 URL */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">浏览器允许私有 URL</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">浏览器工具可访问内网 / 本地地址。</p>
        </div>
        <Switch
          checked={config.allow_private_urls_browser}
          onCheckedChange={(val: boolean) => update('allow_private_urls_browser', val)}
        />
      </div>

      {/* 私有 URL 自动本地化 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">私有 URL 自动本地化</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">访问私有 URL 时自动切换到本地浏览器渲染。</p>
        </div>
        <Switch
          checked={config.auto_local_for_private_urls}
          onCheckedChange={(val: boolean) => update('auto_local_for_private_urls', val)}
        />
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 文件检查点 ══════════ */}
      <h3 className="text-sm font-medium mb-3">文件检查点</h3>

      {/* 检查点启用 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">启用文件检查点</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">启用后 Agent 可创建文件快照以便回滚操作。</p>
        </div>
        <Switch
          checked={config.checkpoints_enabled}
          onCheckedChange={(val: boolean) => update('checkpoints_enabled', val)}
        />
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
