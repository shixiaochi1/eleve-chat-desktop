import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * AdvancedSettings — 高级设置
 *
 * Agent 最大轮次、API 重试、服务层级、工具执行强制、子 Agent 参数
 */
export default function AdvancedSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    max_turns: 90,
    api_max_retries: 3,
    service_tier: 'auto',
    tool_use_enforcement: 'strict',
    max_iterations: 30,
    max_concurrent_children: 1,
    child_timeout_seconds: 600,
    reasoning_effort: 'medium',
    terminal_backend: 'local',
    terminal_timeout: 120,
    tool_output_max_bytes: 50000,
    tool_output_max_lines: 2000,
    tool_output_max_line_length: 1000,
    checkpoints_max_snapshots: 5,
    toolsets: '',
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
      const agent = bc.agent || {};
      const delegation = bc.delegation || {};
      const terminal = bc.terminal || {};
      const tool_output = bc.tool_output || {};
      const checkpoints = bc.checkpoints || {};

      setConfig({
        max_turns: agent.max_turns ?? 90,
        api_max_retries: agent.api_max_retries ?? 3,
        service_tier: agent.service_tier || 'auto',
        tool_use_enforcement: agent.tool_use_enforcement || 'strict',
        max_iterations: delegation.max_iterations ?? 30,
        max_concurrent_children: delegation.max_concurrent_children ?? 1,
        child_timeout_seconds: delegation.child_timeout_seconds ?? 600,
        reasoning_effort: delegation.reasoning_effort || 'medium',
        terminal_backend: terminal.backend || 'local',
        terminal_timeout: terminal.timeout ?? 120,
        tool_output_max_bytes: tool_output.max_bytes ?? 50000,
        tool_output_max_lines: tool_output.max_lines ?? 2000,
        tool_output_max_line_length: tool_output.max_line_length ?? 1000,
        checkpoints_max_snapshots: checkpoints.max_snapshots ?? 5,
        toolsets: (Array.isArray(agent.toolsets) ? agent.toolsets.join(', ') : agent.toolsets || ''),
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
          agent: {
            max_turns: config.max_turns,
            api_max_retries: config.api_max_retries,
            service_tier: config.service_tier,
            tool_use_enforcement: config.tool_use_enforcement,
            toolsets: config.toolsets
              ? config.toolsets.split(',').map((s: string) => s.trim()).filter(Boolean)
              : undefined,
          },
          delegation: {
            max_iterations: config.max_iterations,
            max_concurrent_children: config.max_concurrent_children,
            child_timeout_seconds: config.child_timeout_seconds,
            reasoning_effort: config.reasoning_effort,
          },
          terminal: {
            backend: config.terminal_backend,
            timeout: config.terminal_timeout,
          },
          tool_output: {
            max_bytes: config.tool_output_max_bytes,
            max_lines: config.tool_output_max_lines,
            max_line_length: config.tool_output_max_line_length,
          },
          checkpoints: {
            max_snapshots: config.checkpoints_max_snapshots,
          },
        },
      });
      notifySuccess('高级配置已保存');
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
      {/* ══════════ Agent 设置 ══════════ */}
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        <span className="font-medium">Agent 设置</span>
      </div>

      {/* 最大轮次 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">最大轮次</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={1}
          max={500}
          value={config.max_turns}
          onChange={e => update('max_turns', parseInt(e.target.value) || 90)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          单次对话中 Agent 主动执行的最大轮次数（默认 90）。
        </p>
      </div>

      {/* API 重试次数 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">API 重试次数</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={0}
          max={20}
          value={config.api_max_retries}
          onChange={e => update('api_max_retries', parseInt(e.target.value) || 3)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          API 调用失败时的最大重试次数（默认 3）。
        </p>
      </div>

      {/* 服务层级 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">服务层级</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.service_tier}
          onChange={e => update('service_tier', e.target.value)}
        >
          <option value="auto">auto — 自动选择</option>
          <option value="low">low — 低成本</option>
          <option value="default">default — 标准</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          API 服务优先级层级（部分提供商支持）。
        </p>
      </div>

      {/* 工具执行强制 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">工具执行强制</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.tool_use_enforcement}
          onChange={e => update('tool_use_enforcement', e.target.value)}
        >
          <option value="strict">strict — 严格强制</option>
          <option value="relaxed">relaxed — 宽松</option>
          <option value="off">off — 关闭</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          控制 Agent 是否必须使用工具来完成任务。
        </p>
      </div>

      {/* 终端后端 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">终端后端</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.terminal_backend}
          onChange={e => update('terminal_backend', e.target.value)}
        >
          <option value="local">local — 本地终端</option>
          <option value="docker">docker — Docker 容器</option>
          <option value="ssh">ssh — SSH 远程</option>
          <option value="modal">modal — Modal 云</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          选择 Agent 执行终端命令的后端环境。
        </p>
      </div>

      {/* 终端超时 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">终端超时（秒）</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={5}
          max={3600}
          step={5}
          value={config.terminal_timeout}
          onChange={e => update('terminal_timeout', parseInt(e.target.value) || 120)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          单条终端命令的最大执行时间（默认 120 秒）。
        </p>
      </div>

      {/* 工具集 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">启用的工具集</label>
        <Input
          type="text"
          className="max-w-80"
          placeholder="例如: execute, read, edit, web"
          value={config.toolsets}
          onChange={e => update('toolsets', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          逗号分隔的已启用工具集列表。留空则使用默认集。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 工具输出设置 ══════════ */}
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        <span className="font-medium">工具输出设置</span>
      </div>

      {/* 输出字节限制 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">终端输出限制（字节）</label>
        <input
          className="flex h-8 w-32 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={1000}
          max={500000}
          step={1000}
          value={config.tool_output_max_bytes}
          onChange={e => update('tool_output_max_bytes', parseInt(e.target.value) || 50000)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          终端命令输出的最大字节数（默认 50000）。
        </p>
      </div>

      {/* 文件页限制 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">文件页限制（行）</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={100}
          max={50000}
          step={100}
          value={config.tool_output_max_lines}
          onChange={e => update('tool_output_max_lines', parseInt(e.target.value) || 2000)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          读取文件时每页显示的最大行数（默认 2000）。
        </p>
      </div>

      {/* 行长度限制 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">行长度限制</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={100}
          max={10000}
          step={100}
          value={config.tool_output_max_line_length}
          onChange={e => update('tool_output_max_line_length', parseInt(e.target.value) || 1000)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          文件内容单行最大字符数，超长行会被截断（默认 1000）。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 检查点设置 ══════════ */}
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        <span className="font-medium">检查点设置</span>
      </div>

      {/* 检查点上限 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">检查点上限</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={1}
          max={100}
          step={1}
          value={config.checkpoints_max_snapshots}
          onChange={e => update('checkpoints_max_snapshots', parseInt(e.target.value) || 5)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          最多保留的文件检查点 / 快照数量（默认 5）。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 子 Agent 委派 ══════════ */}
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        <span className="font-medium">子 Agent 委派</span>
      </div>

      {/* 子Agent最大轮次 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">子 Agent 最大轮次</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={1}
          max={500}
          value={config.max_iterations}
          onChange={e => update('max_iterations', parseInt(e.target.value) || 30)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          子 Agent 可执行的最大迭代轮次（默认 30）。
        </p>
      </div>

      {/* 子Agent并发数 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">子 Agent 并发数</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={1}
          max={50}
          value={config.max_concurrent_children}
          onChange={e => update('max_concurrent_children', parseInt(e.target.value) || 1)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          同时运行的最大子 Agent 数量（默认 1）。
        </p>
      </div>

      {/* 子Agent超时 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">子 Agent 超时（秒）</label>
        <input
          className="flex h-8 w-28 items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          type="number"
          min={10}
          max={36000}
          step={10}
          value={config.child_timeout_seconds}
          onChange={e => update('child_timeout_seconds', parseInt(e.target.value) || 600)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          子 Agent 最长运行时间（默认 600 秒）。
        </p>
      </div>

      {/* 子Agent推理深度 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">子 Agent 推理深度</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.reasoning_effort}
          onChange={e => update('reasoning_effort', e.target.value)}
        >
          <option value="">auto — 自动</option>
          <option value="minimal">minimal — 极低</option>
          <option value="low">low — 低</option>
          <option value="medium">medium — 中等</option>
          <option value="high">high — 高</option>
          <option value="xhigh">xhigh — 极高</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          子 Agent 的推理分析深度级别。空值表示自动选择。
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
