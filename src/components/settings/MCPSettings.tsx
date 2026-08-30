/**
 * MCP 设置 — 对齐 Eleve mcp-settings.tsx
 *
 * MCP Server 列表管理：添加/编辑/删除/启用禁用
 * 功能：传输类型标签、计数、env编辑、JSON编辑器
 *
 * 2026-08-31 卡片 UI 重构：裸行列表 → 统一分组卡片列表（逻辑不变）。
 */
import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { SectionCard, SettingsSaveBar } from './SettingBlocks';
import {
  Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw,
  Code2, Server,
} from 'lucide-react';

interface MCPServer {
  name: string;
  command: string;
  args: string;
  enabled: boolean;
  url: string;
  env: string;
}

interface MCPConfigEntry {
  command?: string;
  args?: string | string[];
  enabled?: boolean;
  url?: string;
  env?: unknown;
}

export default function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newServer, setNewServer] = useState<{ name: string; command: string; args: string; env: string }>({ name: '', command: '', args: '', env: '' });
  const [reloading, setReloading] = useState(false);

  const [jsonMode, setJsonMode] = useState(false);
  const [jsonContent, setJsonContent] = useState('');

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const cfg = await call('get_config', {});
      const mcpServers = cfg?.mcp_servers || cfg?.mcp?.servers || {};
      const list = Object.entries(mcpServers as Record<string, MCPConfigEntry>).map(([name, conf]) => ({
        name,
        command: conf.command || '',
        args: Array.isArray(conf.args) ? conf.args.join(' ') : (conf.args || ''),
        enabled: conf.enabled !== false,
        url: conf.url || '',
        env: conf.env ? (typeof conf.env === 'object' ? JSON.stringify(conf.env, null, 2) : String(conf.env)) : '',
      }));
      setServers(list);
      setJsonContent(JSON.stringify(mcpServers, null, 2));
    } catch {
      setServers([]);
    }
    setLoading(false);
  };

  const handleReload = async () => {
    // 🔴 2026-08-30 消费 approvals.mcp_reload_confirm（对齐 Hermes
    // config_defaults.py L2526 默认 true）：重载前需用户确认。
    // 该开关在「设置 → 安全防护 → MCP 重载确认」配置。
    try {
      const cfg = await call('get_config', {});
      const needConfirm = (cfg?.approvals?.mcp_reload_confirm as boolean | undefined) ?? true;
      if (needConfirm && !window.confirm('确认重载所有 MCP 服务器？运行中的 MCP 连接会重建。')) {
        return;
      }
    } catch {
      // 配置读取失败 → 按默认（需确认）走
      if (!window.confirm('确认重载所有 MCP 服务器？运行中的 MCP 连接会重建。')) {
        return;
      }
    }
    setReloading(true);
    try {
      await call('reload_mcp', {});
      notifySuccess('MCP 服务已重载');
      loadServers();
    } catch (err) {
      notifyError(err, '重载 MCP 失败');
    }
    setReloading(false);
  };

  const getTransportType = (s: { url?: string; command?: string }) => {
    if (s.url) return 'http';
    if (s.command) return 'stdio';
    return 'custom';
  };

  const transportLabel = {
    stdio: 'stdio',
    http: 'http',
    custom: 'custom',
  };



  const handleAdd = async () => {
    if (!newServer.name.trim() || !newServer.command.trim()) return;
    try {
      const cfg = await call('get_config', {});
      const mcp: Record<string, any> = cfg?.mcp_servers || {};
      const entry: Record<string, any> = {
        command: newServer.command.trim(),
        args: newServer.args.trim() ? newServer.args.trim().split(/\s+/) : [],
        enabled: true,
      };
      // 解析 env 字段
      const envStr = newServer.env.trim();
      if (envStr) {
        try {
          entry.env = JSON.parse(envStr);
        } catch {
          // 尝试 key=value 格式
          const envObj: Record<string, string> = {};
          envStr.split('\n').forEach((line) => {
            const eqIdx = line.indexOf('=');
            if (eqIdx > 0) {
              envObj[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
            }
          });
          if (Object.keys(envObj).length > 0) entry.env = envObj;
        }
      }
      mcp[newServer.name.trim()] = entry;
      await call('replace_config', { sections: { mcp_servers: mcp } });
      notifySuccess(`MCP Server "${newServer.name.trim()}" 已添加`);
      setNewServer({ name: '', command: '', args: '', env: '' });
      setAddOpen(false);
      loadServers();
    } catch (err) {
      notifyError(err, '添加 MCP Server 失败');
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const cfg = await call('get_config', {});
      const mcp: Record<string, any> = cfg?.mcp_servers || {};
      delete mcp[name];
      await call('replace_config', { sections: { mcp_servers: mcp } });
      notifySuccess(`MCP Server "${name}" 已删除`);
      loadServers();
    } catch (err) {
      notifyError(err, '删除失败');
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      const cfg = await call('get_config', {});
      const mcp = cfg?.mcp_servers || {};
      if (mcp[name]) {
        mcp[name].enabled = !enabled;
        await call('replace_config', { sections: { mcp_servers: mcp } });
        loadServers();
      }
    } catch (err) {
      notifyError(err, '切换状态失败');
    }
  };

  const handleSaveJson = async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      await call('replace_config', { sections: { mcp_servers: parsed } });
      notifySuccess('MCP 配置已通过 JSON 更新');
      setJsonMode(false);
      loadServers();
    } catch (err) {
      notifyError(err, 'JSON 格式错误');
    }
  };

  if (loading) return <div className="px-3 py-2 text-xs text-muted-foreground/70">加载中…</div>;

  return (
    <div className="max-w-2xl">
      <SectionCard
        icon={Server}
        title="MCP Server"
        desc="管理 Model Context Protocol 服务器连接"
        headerTrailing={
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {servers.length} 已配置
            </span>
            <Button variant="ghost" size="icon-xs" onClick={handleReload} disabled={reloading} title="重载所有 MCP">
              <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setJsonMode(!jsonMode)}
              title={jsonMode ? '返回普通模式' : 'JSON 编辑器'}
              className={jsonMode ? 'text-primary' : ''}
            >
              <Code2 size={14} />
            </Button>
          </div>
        }
      >
        {jsonMode ? (
          <div className="p-3.5">
            <label className="mb-1.5 block text-[13px] font-medium leading-snug text-foreground">完整 MCP 配置 (JSON)</label>
            <Textarea
              className="min-h-[200px] font-mono text-xs resize-y whitespace-pre overflow-auto"
              value={jsonContent}
              onChange={(e) => setJsonContent(e.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <Button variant="default" size="sm" className="flex-1" onClick={handleSaveJson}>
                保存 JSON
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setJsonMode(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : servers.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">暂无 MCP Server</p>
            <p className="mt-1 text-xs text-muted-foreground/70">点击下方「添加 MCP Server」创建第一个连接</p>
          </div>
        ) : (
          /* Server 列表（行间 hairline 分隔 + hover 反馈） */
          <>
            {servers.map((s) => {
              const ttype = getTransportType(s);
              return (
                <div key={s.name} className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--ui-row-hover-background)]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-foreground">{s.name}</span>
                      {/* Transport 类型标签 */}
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                        ttype === 'stdio' && 'bg-success/10 text-success',
                        ttype === 'http' && 'bg-info/10 text-info',
                        ttype === 'custom' && 'bg-muted-foreground/10 text-muted-foreground',
                      )}>
                        {transportLabel[ttype]}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                      {s.command} {s.args}
                    </div>
                    {s.env && (
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/50">
                        env: {s.env.length > 40 ? s.env.slice(0, 40) + '…' : s.env}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleToggle(s.name, s.enabled)}
                    title={s.enabled ? '已启用' : '已禁用'}
                    className={s.enabled ? 'text-primary' : 'text-muted-foreground/60'}
                  >
                    {s.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(s.name)} title="删除">
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              );
            })}
          </>
        )}
      </SectionCard>

      {/* 添加表单 / 添加入口（虚线卡，与「添加服务商」同语言） */}
      {addOpen ? (
        <div className="rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card shadow-xs p-3.5 space-y-3">
          <div className="grid gap-1.5">
            <label className="block text-[13px] font-medium leading-snug text-foreground">名称</label>
            <Input className="h-8 text-xs" value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} placeholder="my-server" />
          </div>
          <div className="grid gap-1.5">
            <label className="block text-[13px] font-medium leading-snug text-foreground">命令</label>
            <Input className="h-8 text-xs" value={newServer.command} onChange={(e) => setNewServer({ ...newServer, command: e.target.value })} placeholder="npx @example/mcp-server" />
          </div>
          <div className="grid gap-1.5">
            <label className="block text-[13px] font-medium leading-snug text-foreground">参数 (空格分隔)</label>
            <Input className="h-8 text-xs" value={newServer.args} onChange={(e) => setNewServer({ ...newServer, args: e.target.value })} placeholder="--port 3000" />
          </div>
          <div className="grid gap-1.5">
            <label className="block text-[13px] font-medium leading-snug text-foreground">环境变量 (JSON 或 key=value 每行一个)</label>
            <Textarea
              className="min-h-[60px] font-mono text-xs resize-y"
              value={newServer.env}
              onChange={(e) => setNewServer({ ...newServer, env: e.target.value })}
              placeholder='{"KEY": "value"} 或\nKEY=value'
            />
          </div>
          <SettingsSaveBar>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>取消</Button>
            <Button variant="default" size="sm" onClick={handleAdd} disabled={!newServer.name.trim() || !newServer.command.trim()}>添加</Button>
          </SettingsSaveBar>
        </div>
      ) : (
        !jsonMode && (
          <button
            type="button"
            className="grid min-h-[3.25rem] w-full cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--ui-stroke-tertiary)] bg-transparent text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/30 hover:text-foreground"
            onClick={() => setAddOpen(true)}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Plus size={14} strokeWidth={2} /> 添加 MCP Server
            </span>
          </button>
        )
      )}
    </div>
  );
}
