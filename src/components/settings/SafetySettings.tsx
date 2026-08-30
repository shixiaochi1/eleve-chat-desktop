import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { ClipboardCheck, ShieldCheck, Globe, History } from 'lucide-react';
import { SectionCard, SettingRow, SettingField, SettingsSaveBar } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';

/**
 * SafetySettings — 安全设置
 *
 * 审批模式、命令白名单、隐私保护、浏览器安全、检查点
 *
 * 2026-08-31 卡片 UI 重构：裸表单 → 统一 SectionCard 分组卡片（逻辑不变）。
 */
export default function SafetySettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    approvals_mode: 'manual',
    approvals_timeout: 300,
    mcp_reload_confirm: true,
    command_allowlist: '',
    redact_secrets: true,
    allow_private_urls_security: false,
    allow_private_urls_browser: false,
    auto_local_for_private_urls: true,
    use_real_profile: false,
    checkpoints_enabled: false,
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
      const checkpoints = bc.agent?.checkpoints || {};

      setConfig({
        approvals_mode: approvals.mode || 'manual',
        // 🔴 fallback 对齐 eleve-config default_approvals_timeout()=300（旧 60 与后端不符）
        approvals_timeout: approvals.timeout ?? 300,
        mcp_reload_confirm: approvals.mcp_reload_confirm ?? true,
        command_allowlist: (Array.isArray(approvals.command_allowlist) ? approvals.command_allowlist.join(', ') : approvals.command_allowlist || ''),
        redact_secrets: security.redact_secrets ?? true,
        allow_private_urls_security: security.allow_private_urls ?? false,
        allow_private_urls_browser: browser.allow_private_urls ?? false,
        // 🔴 fallback 对齐 default_auto_local_for_private_urls()=true
        auto_local_for_private_urls: browser.auto_local_for_private_urls ?? true,
        use_real_profile: browser.use_real_profile ?? false,
        // 🔴 fallback 对齐 CheckpointsConfig.enabled 默认 false
        checkpoints_enabled: checkpoints.enabled ?? false,
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
            use_real_profile: config.use_real_profile,
          },
          agent: {
            checkpoints: {
              enabled: config.checkpoints_enabled,
            },
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
    <div className="max-w-2xl">
      {/* ══════════ 审批设置 ══════════ */}
      <SectionCard icon={ClipboardCheck} title="审批设置" desc="工具调用是否需要用户确认">
        <SettingField label="审批模式" desc="控制工具调用是否需要用户审批。smart 模式下低风险操作自动放行。">
          <select
            className={selectCls}
            value={config.approvals_mode}
            onChange={e => update('approvals_mode', e.target.value)}
          >
            <option value="manual">manual — 手动审批</option>
            <option value="smart">smart — 智能审批</option>
            <option value="off">off — 关闭审批</option>
          </select>
        </SettingField>
        <SettingField label="审批超时（秒）" desc="待审批操作的超时时间。超时后操作将自动拒绝（默认 300 秒）。">
          <Input
            type="number"
            min={5}
            max={600}
            step={5}
            value={config.approvals_timeout}
            onChange={e => update('approvals_timeout', parseInt(e.target.value) || 60)}
            className="w-40"
          />
        </SettingField>
        <SettingRow label="MCP 重载确认" desc="重载 MCP 服务器前需要用户确认。">
          <Switch
            checked={config.mcp_reload_confirm}
            onCheckedChange={(val: boolean) => update('mcp_reload_confirm', val)}
          />
        </SettingRow>
        <SettingField label="命令白名单" desc="逗号分隔的允许执行命令列表。留空表示所有命令均需审批。">
          <Input
            type="text"
            placeholder="例如: git, npm, curl"
            value={config.command_allowlist}
            onChange={e => update('command_allowlist', e.target.value)}
          />
        </SettingField>
      </SectionCard>

      {/* ══════════ 隐私与安全 ══════════ */}
      <SectionCard icon={ShieldCheck} title="隐私与安全" desc="敏感信息与内网访问保护">
        <SettingRow label="隐藏敏感信息" desc="在日志和界面中隐藏 API Key 等敏感信息。">
          <Switch
            checked={config.redact_secrets}
            onCheckedChange={(val: boolean) => update('redact_secrets', val)}
          />
        </SettingRow>
        {/* 允许私有 URL（安全）—— 🔴 2026-08-30 链路接通：消费方 web_extract
            （check_url_safety_with_config，对齐 Hermes url_safety.py 全局开关语义）。
            与下方「浏览器允许私有 URL」是两个独立维度：本开关管网页提取等通用
            工具，浏览器开关管 browser_* 工具族（Hermes 分组同款）。 */}
        <SettingRow label="允许私有 URL（安全）" desc="网页提取等通用工具可访问内网 / 本地地址（不影响浏览器工具，后者用下方独立开关）。">
          <Switch
            checked={config.allow_private_urls_security}
            onCheckedChange={(val: boolean) => update('allow_private_urls_security', val)}
          />
        </SettingRow>
      </SectionCard>

      {/* ══════════ 浏览器安全 ══════════ */}
      <SectionCard icon={Globe} title="浏览器安全" desc="内置浏览器的内网访问与登录态">
        <SettingRow label="浏览器允许私有 URL" desc="浏览器工具可访问内网 / 本地地址。">
          <Switch
            checked={config.allow_private_urls_browser}
            onCheckedChange={(val: boolean) => update('allow_private_urls_browser', val)}
          />
        </SettingRow>
        <SettingRow label="私有 URL 自动本地化" desc="访问私有 URL 时自动切换到本地浏览器渲染。">
          <Switch
            checked={config.auto_local_for_private_urls}
            onCheckedChange={(val: boolean) => update('auto_local_for_private_urls', val)}
          />
        </SettingRow>
        {/* 🔴 2026-08-29 对齐 Hermes 设置页 Browser 分组 useRealProfile
            （settings/constants.ts L431/L560：真实登录态副本浏览，默认关闭） */}
        <SettingRow label="使用真实浏览器配置" desc="把默认 Chromium 浏览器的配置（Cookies/登录/偏好）复制进托管快照副本驱动，绝不直接打开正在使用的浏览器配置，每次运行重新同步。仅支持 Chromium 系默认浏览器（Chrome/Edge/Brave/Chromium），其他默认浏览器会明确报错。默认关闭。">
          <Switch
            checked={config.use_real_profile}
            onCheckedChange={(val: boolean) => update('use_real_profile', val)}
          />
        </SettingRow>
      </SectionCard>

      {/* ══════════ 文件检查点 ══════════ */}
      <SectionCard icon={History} title="文件检查点" desc="文件操作快照与回滚">
        <SettingRow label="启用文件检查点" desc="启用后 Agent 可创建文件快照以便回滚操作。">
          <Switch
            checked={config.checkpoints_enabled}
            onCheckedChange={(val: boolean) => update('checkpoints_enabled', val)}
          />
        </SettingRow>
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
