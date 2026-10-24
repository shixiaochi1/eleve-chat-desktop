import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader, KeyRound, Globe } from 'lucide-react';
import { call } from '../../utils/bridge';
import { notifyError, notifySuccess } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * BotPeersSection — peer 智能体网关注册表（对齐 Hermes `hermes peer list/add/remove`，
 * `hermes_cli/subcommands/peer.py:225-273`）。
 *
 * 与上方「远程 Bot 连接」是两条不同通道：
 * - 远程 Bot 连接 = Desktop relay（WS 连接 + 花名册 UNION）；
 * - peer 网关 = 对端实现 stock API（`GET/POST /api/sessions` + `/chat`），
 *   供 `message_agent` 的 `<peer>` / `<peer>/<agent>` 目标使用（异构 agent 也能接入）。
 *
 * 数据源/写入口 = WS RPC `bot.peers.*`（后端校验 + `config.update_value` 热更新）；
 * list 只回 `key_configured`，**永不回传密钥明文**。
 */

interface PeerRow {
  name: string;
  url: string;
  key_configured: boolean;
}

function rowsOf(res: unknown): PeerRow[] {
  const peers = (res as { peers?: unknown } | null)?.peers;
  return Array.isArray(peers) ? (peers as PeerRow[]) : [];
}

export default function BotPeersSection() {
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await call('bot.peers.list', {});
      setPeers(rowsOf(res));
    } catch (e) {
      notifyError(e, '读取 peer 注册表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitAdd = async () => {
    if (!name.trim() || !url.trim() || busy) return;
    setBusy(true);
    try {
      const res = await call('bot.peers.add', {
        name: name.trim(),
        url: url.trim(),
        api_key: apiKey.trim(),
      });
      setPeers(rowsOf(res));
      notifySuccess(`已注册 peer「${name.trim()}」`);
      setAdding(false);
      setName('');
      setUrl('');
      setApiKey('');
    } catch (e) {
      notifyError(e, '注册 peer 失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (peerName: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await call('bot.peers.remove', { name: peerName });
      setPeers(rowsOf(res));
      notifySuccess(`已移除 peer「${peerName}」`);
    } catch (e) {
      notifyError(e, '移除 peer 失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          注册项供 <code className="text-[11px]">message_agent</code> 的{' '}
          <code className="text-[11px]">&lt;peer&gt;</code> /{' '}
          <code className="text-[11px]">&lt;peer&gt;/&lt;agent&gt;</code> 目标使用；对端需实现
          stock API（<code className="text-[11px]">/api/sessions</code>）。
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setAdding(v => !v)}
        >
          <Plus size={12} />
          {adding ? '取消' : '添加 peer'}
        </Button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-[var(--ui-stroke-tertiary)] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              placeholder="名称（如 spark；字母数字 - _ .，≤64）"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <Input
              placeholder="网关地址（http:// 或 https://）"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </div>
          <Input
            type="password"
            placeholder="API 密钥（可留空；支持 ${VAR} 引用 .env）"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="default"
              size="sm"
              disabled={busy || !name.trim() || !url.trim()}
              onClick={() => void submitAdd()}
            >
              {busy ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
              保存 peer
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader size={12} className="animate-spin" />
          读取中…
        </div>
      ) : peers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          尚未注册 peer。未注册时，<code className="text-[11px]">&lt;peer&gt;</code> 目标会返回
          “No registered peer named …”。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {peers.map(peer => (
            <li
              key={peer.name}
              className="flex items-center gap-2 rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-2"
            >
              <Globe size={13} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">@{peer.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{peer.url}</div>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1 text-[11px] ${
                  peer.key_configured ? 'text-success' : 'text-muted-foreground'
                }`}
                title={peer.key_configured ? '密钥已配置' : '未配置密钥（对端若启用鉴权将 401）'}
              >
                <KeyRound size={11} />
                {peer.key_configured ? '已配置密钥' : '无密钥'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove(peer.name)}
                title="移除"
              >
                <Trash2 size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
