import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Brain, Shrink } from 'lucide-react';
import { SectionCard, SettingRow, SettingField, SettingsSaveBar } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';
import MemoryPanel from '../MemoryPanel';

/**
 * MemorySettings — 记忆与上下文设置
 *
 * 顶部：记忆数据总览（当前 Agent 的 MEMORY.md/USER.md 用量/条目/重置，对齐 Hermes）
 * 下方：持久化记忆、用户画像、记忆预算、提供商、自动压缩（对齐 Hermes compression 配置语义）
 *
 * 2026-08-31 卡片 UI 重构：裸表单 → 统一 SectionCard 分组卡片（逻辑不变）。
 */
export default function MemorySettings({ onSaved, currentProfile }: { onSaved?: () => void; currentProfile?: string }) {
  // 字符上限初始为占位 0：loadConfig 从配置覆盖（config.get 恒返后端默认值），loaded 门控保证加载前不渲染
  const [config, setConfig] = useState({
    memory_enabled: true,
    user_profile_enabled: true,
    memory_char_limit: 0,
    user_char_limit: 0,
    memory_provider: 'builtin',
    compression_enabled: true,
    compression_threshold: 0.5,
    compression_target_ratio: 0.2,
    compression_protect_last_n: 20,
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
      const memory = bc.memory || {};
      const compression = bc.compression || {};

      setConfig({
        memory_enabled: memory.memory_enabled ?? true,
        user_profile_enabled: memory.user_profile_enabled ?? true,
        // 跟随配置走：config.get 返回后端已应用默认值（default_memory_char_limit=2200 / default_user_char_limit=1375）的完整配置，前端不硬编码兜底
        memory_char_limit: memory.memory_char_limit,
        user_char_limit: memory.user_char_limit,
        // 后端键名 provider（空串 = builtin，对齐 Hermes memory.provider 语义）
        memory_provider: memory.provider || 'builtin',
        compression_enabled: compression.enabled ?? true,
        compression_threshold: compression.threshold ?? 3000,
        compression_target_ratio: compression.target_ratio ?? 0.3,
        compression_protect_last_n: compression.protect_last_n ?? 4,
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
          memory: {
            memory_enabled: config.memory_enabled,
            user_profile_enabled: config.user_profile_enabled,
            memory_char_limit: config.memory_char_limit,
            user_char_limit: config.user_char_limit,
            // builtin → 空串（后端语义：非空 = 外部插件名，空 = 仅内置）
            provider: config.memory_provider === 'builtin' ? '' : config.memory_provider,
          },
          compression: {
            enabled: config.compression_enabled,
            threshold: config.compression_threshold,
            target_ratio: config.compression_target_ratio,
            protect_last_n: config.compression_protect_last_n,
          },
        },
      });
      notifySuccess('记忆配置已保存');
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
      {/* 记忆数据 — 侧边栏记忆面板合并至此（当前 Agent 的记忆内容总览） */}
      <MemoryPanel currentProfile={currentProfile} />

      {/* 持久化记忆与用户画像 */}
      <SectionCard icon={Brain} title="记忆与画像" desc="跨会话记忆与用户个性化画像">
        <SettingRow label="持久化记忆" desc="跨会话自动保存和检索关键信息，增强 Agent 连续性。">
          <Switch
            checked={config.memory_enabled}
            onCheckedChange={(val: boolean) => update('memory_enabled', val)}
          />
        </SettingRow>
        <SettingRow label="用户画像" desc="基于对话历史构建用户偏好画像，提供个性化回复。">
          <Switch
            checked={config.user_profile_enabled}
            onCheckedChange={(val: boolean) => update('user_profile_enabled', val)}
          />
        </SettingRow>
        <SettingField label="记忆预算（字符数）" desc="持久化记忆存储的最大字符数。">
          <Input
            type="number"
            min={1000}
            max={500000}
            step={1000}
            value={config.memory_char_limit}
            onChange={e => update('memory_char_limit', parseInt(e.target.value) || config.memory_char_limit)}
            className="w-40"
          />
        </SettingField>
        <SettingField label="画像预算（字符数）" desc="用户画像存储的最大字符数。">
          <Input
            type="number"
            min={500}
            max={100000}
            step={500}
            value={config.user_char_limit}
            onChange={e => update('user_char_limit', parseInt(e.target.value) || config.user_char_limit)}
            className="w-40"
          />
        </SettingField>
        <SettingField label="记忆提供商" desc="选择记忆存储的后端服务提供商。">
          <select
            className={selectCls}
            value={config.memory_provider}
            onChange={e => update('memory_provider', e.target.value)}
          >
            <option value="builtin">builtin — 内置本地存储</option>
            <option value="honcho" disabled>honcho — Honcho API（待实现）</option>
          </select>
        </SettingField>
      </SectionCard>

      {/* 自动压缩 */}
      <SectionCard icon={Shrink} title="自动压缩" desc="上下文超阈值后自动压缩，而非截断">
        <SettingRow label="启用自动压缩" desc="上下文占用接近阈值时自动压缩历史消息。">
          <Switch
            checked={config.compression_enabled}
            onCheckedChange={(val: boolean) => update('compression_enabled', val)}
          />
        </SettingRow>
        <SettingField label="压缩阈值（上下文比率）" desc="上下文占用超过此比率时触发自动压缩（默认 0.50，即上下文窗口的 50%）。">
          <Input
            type="number"
            min={0.05}
            max={0.95}
            step={0.05}
            value={config.compression_threshold}
            onChange={e => update('compression_threshold', parseFloat(e.target.value) || 0.5)}
            className="w-40"
          />
        </SettingField>
        <SettingField label="压缩目标比率" desc="尾部预算占阈值的比例，越大保留越多近期消息（默认 0.20）。">
          <Input
            type="number"
            min={0.05}
            max={0.95}
            step={0.05}
            value={config.compression_target_ratio}
            onChange={e => update('compression_target_ratio', parseFloat(e.target.value) || 0.3)}
            className="w-40"
          />
        </SettingField>
        <SettingField label="保护最近消息数" desc="压缩时始终保留最近 N 条完整消息不被压缩（默认 20）。">
          <Input
            type="number"
            min={1}
            max={100}
            step={1}
            value={config.compression_protect_last_n}
            onChange={e => update('compression_protect_last_n', parseInt(e.target.value) || 4)}
            className="w-40"
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
