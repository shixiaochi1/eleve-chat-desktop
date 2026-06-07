import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * MemorySettings — 记忆与上下文设置
 *
 * 持久化记忆、用户画像、记忆预算、提供商、上下文引擎、自动压缩
 */
export default function MemorySettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    memory_enabled: true,
    user_profile_enabled: true,
    memory_char_limit: 50000,
    user_char_limit: 10000,
    memory_provider: 'builtin',
    context_engine: 'compressor',
    compression_enabled: true,
    compression_threshold: 3000,
    compression_target_ratio: 0.3,
    compression_protect_last_n: 4,
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
        memory_char_limit: memory.memory_char_limit ?? 50000,
        user_char_limit: memory.user_char_limit ?? 10000,
        memory_provider: memory.memory_provider || 'builtin',
        context_engine: bc.context_engine || 'compressor',
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
            memory_provider: config.memory_provider,
          },
          context_engine: config.context_engine,
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
    <div>
      {/* 持久化记忆 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">持久化记忆</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">跨会话自动保存和检索关键信息，增强 Agent 连续性。</p>
        </div>
        <Switch
          checked={config.memory_enabled}
          onCheckedChange={(val: boolean) => update('memory_enabled', val)}
        />
      </div>

      {/* 用户画像 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">用户画像</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">基于对话历史构建用户偏好画像，提供个性化回复。</p>
        </div>
        <Switch
          checked={config.user_profile_enabled}
          onCheckedChange={(val: boolean) => update('user_profile_enabled', val)}
        />
      </div>

      <div className="border-t border-border my-4" />

      {/* 记忆预算 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">记忆预算（字符数）</label>
        <Input
          type="number"
          min={1000}
          max={500000}
          step={1000}
          value={config.memory_char_limit}
          onChange={e => update('memory_char_limit', parseInt(e.target.value) || 50000)}
          className="w-40"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          持久化记忆存储的最大字符数。
        </p>
      </div>

      {/* 画像预算 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">画像预算（字符数）</label>
        <Input
          type="number"
          min={500}
          max={100000}
          step={500}
          value={config.user_char_limit}
          onChange={e => update('user_char_limit', parseInt(e.target.value) || 10000)}
          className="w-40"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          用户画像存储的最大字符数。
        </p>
      </div>

      {/* 记忆提供商 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">记忆提供商</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.memory_provider}
          onChange={e => update('memory_provider', e.target.value)}
        >
          <option value="builtin">builtin — 内置本地存储</option>
          <option value="honcho">honcho — Honcho API</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          选择记忆存储的后端服务提供商。
        </p>
      </div>

      {/* 上下文引擎 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">上下文引擎</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.context_engine}
          onChange={e => update('context_engine', e.target.value)}
        >
          <option value="compressor">compressor — 智能压缩</option>
          <option value="default">default — 原始上下文</option>
          <option value="custom">custom — 自定义策略</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          控制上下文窗口的管理策略。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* 自动压缩 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">自动压缩</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">上下文超阈值后自动压缩，而非截断。</p>
        </div>
        <Switch
          checked={config.compression_enabled}
          onCheckedChange={(val: boolean) => update('compression_enabled', val)}
        />
      </div>

      {/* 压缩阈值 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">压缩阈值（字符数）</label>
        <Input
          type="number"
          min={500}
          max={100000}
          step={500}
          value={config.compression_threshold}
          onChange={e => update('compression_threshold', parseInt(e.target.value) || 3000)}
          className="w-40"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          上下文达到此字符数时触发自动压缩。
        </p>
      </div>

      {/* 压缩目标比率 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">压缩目标比率</label>
        <Input
          type="number"
          min={0.05}
          max={0.95}
          step={0.05}
          value={config.compression_target_ratio}
          onChange={e => update('compression_target_ratio', parseFloat(e.target.value) || 0.3)}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          压缩后保留原始上下文的比例（默认 0.3，即保留 30%）。
        </p>
      </div>

      {/* 保护最近 N 条消息 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">保护最近消息数</label>
        <Input
          type="number"
          min={1}
          max={100}
          step={1}
          value={config.compression_protect_last_n}
          onChange={e => update('compression_protect_last_n', parseInt(e.target.value) || 4)}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          压缩时始终保留最近 N 条完整消息不被压缩（默认 4）。
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
