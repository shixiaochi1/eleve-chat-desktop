import { useState } from 'react';
import { Plus, Pencil, Trash2, Loader, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  useRemoteConnections,
  addRemoteConnection,
  updateRemoteConnection,
  removeRemoteConnection,
  probeRemote,
} from '../../services/connections';
import type { RemoteConnection } from '../../services/connections';

/**
 * RemoteConnectionsRegistry — 远程 bot 连接注册表 UI（stage-2 settings）。
 *
 * 🔴 2026-09-04 Bot Mode stage-2：数据层 = services/connections.ts
 * （localStorage eleve.connections.remote，socket 惰性建连 + requestForBot
 * 骑行路由，对齐 Hermes Desktop connections-registry）。本组件只做
 * 增删改查 + 探测；stage-3 花名册 UNION 与跨网关 DM 消费同一份注册表。
 * 主连接（getWsClient / 连接模式卡片）不受本注册表影响。
 */

/** 输入规范化：允许省略 ws:// 前缀（wsUrl 契约 = ws://host:port 无路径） */
function normalizeWsInput(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^wss?:\/\//i.test(s)) return s;
  return 'ws://' + s;
}

interface ProbeState {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export default function RemoteConnectionsRegistry() {
  const connections = useRemoteConnections();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});

  const submitAdd = () => {
    const url = normalizeWsInput(wsUrl);
    if (!url) return;
    addRemoteConnection(name, url);
    setAdding(false);
  };

  const submitEdit = () => {
    if (!editId) return;
    const url = normalizeWsInput(editUrl);
    if (!url) return;
    updateRemoteConnection(editId, editName, url);
    setEditId(null);
  };

  const startEdit = (c: RemoteConnection) => {
    setEditId(c.id);
    setEditName(c.name);
    setEditUrl(c.wsUrl);
  };

  const runProbe = async (id: string, url: string) => {
    setProbingId(id);
    try {
      const r = await probeRemote(url);
      setProbes(p => ({ ...p, [id]: r }));
    } catch (e) {
      setProbes(p => ({ ...p, [id]: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setProbingId(null);
    }
  };

  return (
    <div className="space-y-2">
      {connections.map(c => {
        const pr = probes[c.id];
        return (
          <div key={c.id} className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-2">
            {editId === c.id ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="名称"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={editUrl}
                    onChange={e => setEditUrl(e.target.value)}
                    placeholder="ws://192.168.1.10:7878"
                    className="h-8 flex-1 text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setEditId(null)}>
                    取消
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!normalizeWsInput(editUrl)}
                    onClick={submitEdit}
                  >
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.wsUrl}</div>
                  {pr && (
                    <div className={`mt-1 flex items-center gap-1 text-xs ${pr.ok ? 'text-success' : 'text-destructive'}`}>
                      {pr.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      <span>{pr.ok ? `可达（${pr.latencyMs ?? '?'}ms）` : `不可达：${pr.error ?? '未知错误'}`}</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={probingId === c.id}
                    onClick={() => runProbe(c.id, c.wsUrl)}
                  >
                    {probingId === c.id ? <Loader size={11} className="animate-spin" /> : null}
                    探测
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => startEdit(c)}>
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive"
                    onClick={() => removeRemoteConnection(c.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-2">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="名称（如 home-server）"
                className="h-8 text-xs"
              />
              <Input
                value={wsUrl}
                onChange={e => setWsUrl(e.target.value)}
                placeholder="192.168.1.10:7878（可省略 ws://）"
                className="h-8 flex-1 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setAdding(false)}>
                取消
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                disabled={!normalizeWsInput(wsUrl)}
                onClick={submitAdd}
              >
                添加
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {connections.length === 0 && !adding ? (
        <div className="text-xs text-muted-foreground/70">暂无远程连接。添加后可在 Bots 花名册看到远端 Agent。</div>
      ) : null}

      {!adding ? (
        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)}>
          <Plus size={12} />
          添加远程连接
        </Button>
      ) : null}
    </div>
  );
}
