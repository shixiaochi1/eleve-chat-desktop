import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * WorkspaceSettings — 工作区设置
 *
 * 工作目录、代码执行模式、持久化 Shell、环境变量透传、文件读取限制
 */
export default function WorkspaceSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    cwd: '',
    code_exec_mode: 'project',
    persistent_shell: false,
    env_whitelist: '',
    file_read_limit: 10485760,
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
      setConfig({
        cwd: bc.cwd || '',
        code_exec_mode: bc.code_exec_mode || 'project',
        persistent_shell: bc.persistent_shell ?? false,
        env_whitelist: Array.isArray(bc.env_whitelist) ? bc.env_whitelist.join(', ') : (bc.env_whitelist || ''),
        file_read_limit: bc.file_read_limit ?? 10485760,
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
      // 环境变量透传：逗号分隔 → 数组
      const envArray = config.env_whitelist
        ? config.env_whitelist.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      await call('update_config', {
        config: {
          cwd: config.cwd || undefined,
          code_exec_mode: config.code_exec_mode,
          persistent_shell: config.persistent_shell,
          env_whitelist: envArray,
          file_read_limit: config.file_read_limit,
        },
      });
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
      {/* 工作目录 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">工作目录 (CWD)</label>
        <Input
          type="text"
          placeholder="/home/user/projects"
          value={config.cwd}
          onChange={e => update('cwd', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          子进程运行的默认工作目录，留空使用应用根目录。
        </p>
      </div>

      {/* 代码执行模式 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">代码执行模式</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
            保持子进程 Shell 会话不中断，提升连续命令执行效率。
          </p>
        </div>
        <Switch
          checked={config.persistent_shell}
          onCheckedChange={(val: boolean) => update('persistent_shell', val)}
        />
      </div>

      {/* 环境变量透传 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">环境变量透传</label>
        <Input
          type="text"
          placeholder="PATH, HOME, NODE_ENV"
          value={config.env_whitelist}
          onChange={e => update('env_whitelist', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          逗号分隔的环境变量名称列表，子进程可继承这些变量。
        </p>
      </div>

      {/* 文件读取限制 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">文件读取限制（字节）</label>
        <Input
          type="number"
          className="w-40"
          min={1024}
          max={1073741824}
          step={1024}
          value={config.file_read_limit}
          onChange={e => update('file_read_limit', parseInt(e.target.value) || 10485760)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          单次读取文件的字节上限（默认 10 MB）。
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
