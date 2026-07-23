/**
 * MCP 设置 — 对齐 Eleve mcp-settings.tsx
 *
 * MCP Server 列表管理：添加/编辑/删除/启用禁用
 * 功能：传输类型标签、计数、env编辑、JSON编辑器
 */
import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import {
  Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw,
  Terminal, Globe, Wrench, Code2, Edit3,
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
      await call('update_config', { config: { mcp_servers: mcp } });
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
      await call('update_config', { config: { mcp_servers: mcp } });
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
        await call('update_config', { config: { mcp_servers: mcp } });
        loadServers();
      }
    } catch (err) {
      notifyError(err, '切换状态失败');
    }
  };

  const handleSaveJson = async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      await call('update_config', { config: { mcp_servers: parsed } });
      notifySuccess('MCP 配置已通过 JSON 更新');
      setJsonMode(false);
      loadServers();
    } catch (err) {
      notifyError(err, 'JSON 格式错误');
    }
  };

  if (loading) return <div className="px-3 py-2 text-xs text-muted-foreground/70">加载中…</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground">MCP Server 管理</span>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
          {servers.length} 已配置
        </span>
      </div>
      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3">管理 Model Context Protocol 服务器连接。</p>

      {/* 操作栏：刷新 + JSON 切换 */}
      <div className="flex items-center justify-end gap-2 mb-3">
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

      {/* JSON 编辑器模式 */}
      {jsonMode ? (
        <div className="border border-border rounded-lg p-3 bg-card mb-3">
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">完整 MCP 配置 (JSON)</label>
            <Textarea
              className="min-h-[200px] font-mono text-xs resize-y whitespace-pre overflow-auto"
              value={jsonContent}
              onChange={(e) => setJsonContent(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" className="flex-1" onClick={handleSaveJson}>
              保存 JSON
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setJsonMode(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* 空状态 */}
          {servers.length === 0 && !addOpen && (
            <div className="py-6 text-center">
              <p className="text-xs text-muted-foreground">暂无 MCP Server</p>
              <p className="text-xs text-muted-foreground/70 mt-1">点击下方按钮添加</p>
            </div>
          )}

          {/* Server 列表 */}
          {servers.map((s) => {
            const ttype = getTransportType(s);
            return (
              <div key={s.name} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 rounded-md mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{s.name}</span>
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
                  <div className="text-[11px] text-muted-foreground/70 font-mono mt-0.5 truncate">
                    {s.command} {s.args}
                  </div>
                  {s.env && (
                    <div className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
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

          {/* 添加表单 */}
          {addOpen ? (
            <div className="border border-border rounded-lg p-3 bg-card mt-2">
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">名称</label>
                <Input className="h-8 text-xs" value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} placeholder="my-server" />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">命令</label>
                <Input className="h-8 text-xs" value={newServer.command} onChange={(e) => setNewServer({ ...newServer, command: e.target.value })} placeholder="npx @example/mcp-server" />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">参数 (空格分隔)</label>
                <Input className="h-8 text-xs" value={newServer.args} onChange={(e) => setNewServer({ ...newServer, args: e.target.value })} placeholder="--port 3000" />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">环境变量 (JSON 或 key=value 每行一个)</label>
                <Textarea
                  className="min-h-[60px] font-mono text-xs resize-y"
                  value={newServer.env}
                  onChange={(e) => setNewServer({ ...newServer, env: e.target.value })}
                  placeholder='{"KEY": "value"} 或\nKEY=value'
                />
              </div>
              <div className="flex gap-2">
                <Button variant="default" size="sm" className="flex-1" onClick={handleAdd} disabled={!newServer.name.trim() || !newServer.command.trim()}>添加</Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddOpen(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> 添加 MCP Server
            </Button>
          )}
        </>
      )}
    </div>
  );
}
