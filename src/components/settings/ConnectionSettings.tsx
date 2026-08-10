import { useEffect, useState } from 'react';
import { Network, Link2, Loader, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { notifySuccess, notifyError } from '../../utils/notifications';
import {
  type ConnectionState,
  DEFAULT_CONNECTION,
  loadConnection,
  saveConnection,
  probeRemote,
  normalizeRemoteBaseUrl,
} from '../../lib/connection';

/**
 * ConnectionSettings — 连接设置（对齐 Hermes gateway-settings 的连接区块）
 *
 * local：Tauri 壳本地 spawn eleved（默认，无需配置）
 * remote：直连远程 eleved（--listen/--port 部署的实例），探测 /api/status
 *   验证可达性 + 版本（对齐 Hermes probeConnectionConfig）。
 *
 * 🔴 生效方式：保存后写入 settings.json，**下次启动应用**生效（WS 连接
 * base 在启动时决定）。与 Hermes 一致（connection 切换走 setConnection +
 * 重连；ELEVE 最小集 = 重启应用，避免运行时切换的会话断线复杂度）。
 */
export default function ConnectionSettings() {
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [baseUrl, setBaseUrl] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    reachable: boolean;
    version: string | null;
    error: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const conn = loadConnection();
    setMode(conn.mode);
    setBaseUrl(conn.baseUrl);
    setRemoteVersion(conn.remoteVersion ?? null);
    setLoaded(true);
  }, []);

  const handleProbe = async () => {
    if (!baseUrl.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const r = await probeRemote(baseUrl);
      setProbeResult({ reachable: r.reachable, version: r.version, error: r.error });
      if (r.reachable && r.version) setRemoteVersion(r.version);
    } catch (err) {
      setProbeResult({ reachable: false, version: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const next: ConnectionState =
        mode === 'remote'
          ? { mode: 'remote', baseUrl: normalizeRemoteBaseUrl(baseUrl), remoteVersion }
          : { ...DEFAULT_CONNECTION };
      await saveConnection(next);
      // 🔴 不立即 applyConnection：当前 WS 已连旧 base，立即改 HTTP base 会造成
      // WS（旧连接）与 HTTP（新 base）状态分裂。连接 base 只在启动时决定
      // （对齐 Hermes：connection 切换走 setConnection + 全量重连；ELEVE 最小集 =
      // 重启应用，避免运行时切换的会话断线复杂度）。
      notifySuccess(mode === 'remote' ? `已保存远程连接（${next.baseUrl}），重启应用后生效` : '已保存本地连接，重启应用后生效');
    } catch (e) {
      notifyError(e, '保存连接配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-xs text-muted-foreground/70">加载中…</p>;

  return (
    <div>
      {/* 模式切换 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">连接模式</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('local')}
            className={`flex-1 rounded border px-3 py-2 text-xs transition-colors ${
              mode === 'local'
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            本地（本机后端）
          </button>
          <button
            type="button"
            onClick={() => setMode('remote')}
            className={`flex-1 rounded border px-3 py-2 text-xs transition-colors ${
              mode === 'remote'
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            远程（直连后端）
          </button>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          本地模式由桌面应用自动启动本机后端；远程模式直连已部署的远程后端
          （远程 eleved 需以 --listen 0.0.0.0 --port &lt;端口&gt; 启动）。
        </p>
      </div>

      {mode === 'remote' && (
        <>
          {/* 远程地址 */}
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">远程后端地址</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="http://192.168.1.100:8000（可省略 http://）"
                value={baseUrl}
                onChange={e => {
                  setBaseUrl(e.target.value);
                  setProbeResult(null);
                }}
              />
              <Button variant="secondary" size="sm" disabled={probing || !baseUrl.trim()} onClick={handleProbe}>
                {probing ? <Loader size={12} className="animate-spin" /> : <Link2 size={12} />}
                {probing ? '探测中…' : '探测'}
              </Button>
            </div>

            {/* 探测结果（对齐 Hermes probe 反馈：reachable + version） */}
            {probeResult && (
              <div
                className={`mt-2 flex items-center gap-1.5 text-xs ${
                  probeResult.reachable ? 'text-success' : 'text-destructive'
                }`}
              >
                {probeResult.reachable ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <XCircle size={12} />
                )}
                <span>
                  {probeResult.reachable
                    ? `已连接 — Eleve Agent v${probeResult.version ?? '?'}`
                    : `无法连接：${probeResult.error ?? '未知错误'}`}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
              远程后端的文件/终端/会话操作全部在远端执行。
              当前为无鉴权模式（LAN 信任），请勿暴露到公网。
            </p>
          </div>
        </>
      )}

      {/* 保存 */}
      <div className="mt-4">
        <Button variant="default" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存连接配置'}
        </Button>
      </div>

      {/* 当前状态 */}
      <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <Network size={12} />
        <span>
          当前：{mode === 'local' ? '本地模式' : `远程模式（${normalizeRemoteBaseUrl(baseUrl) || '未配置地址'}）`}
          {mode === 'remote' && remoteVersion ? ` · v${remoteVersion}` : ''}
        </span>
      </div>
    </div>
  );
}
