/**
 * RollbackPanel — Git 回滚面板（F4 T4.4）
 *
 * 对齐 Hermes rollback.list/diff/restore：
 * - 列出最近 20 个 commit（hash + message）
 * - 点击查看 diff
 * - 一键 revert（git revert --no-edit）
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { listRollbacks, getRollbackDiff, restoreRollback } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { GitCommit, RefreshCw, Eye, Undo2 } from 'lucide-react';

interface RollbackEntry {
  hash: string;
  message: string;
}

interface RollbackPanelProps {
  sessionId?: string;
  [key: string]: unknown;
}

export default function RollbackPanel({ sessionId }: RollbackPanelProps) {
  const [entries, setEntries] = useState<RollbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  // 用 sessionStorage 缓存 cwd（从 session.info 获取）
  const [cwd, setCwd] = useState<string>(() => sessionStorage.getItem('rollback_cwd') || '.');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRollbacks(cwd);
      setEntries(res.rollbacks || []);
    } catch (e) {
      notifyError(e, '获取回滚列表失败');
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再加载。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) refresh(); })
      .catch(() => { if (!cancelled) notifyError('无法连接网关，请检查后端服务', '获取回滚列表失败'); });
    return () => { cancelled = true; };
  }, [refresh]);

  const handleViewDiff = useCallback(async (hash: string) => {
    setSelectedHash(hash);
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await getRollbackDiff(hash, cwd);
      setDiff(res.diff || '(无差异)');
    } catch (e) {
      setDiff(`获取 diff 失败: ${(e as Error).message}`);
    } finally {
      setDiffLoading(false);
    }
  }, [cwd]);

  const handleRestore = useCallback(async (hash: string) => {
    if (!window.confirm(`确认 revert commit ${hash.slice(0, 7)}？`)) return;
    try {
      await restoreRollback(hash, cwd);
      notifySuccess(`已 revert ${hash.slice(0, 7)}`);
      refresh();
    } catch (e) {
      notifyError(e, 'Revert 失败');
    }
  }, [cwd, refresh]);

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '加载中…' : '刷新'}
        </button>
        <span className="text-xs text-muted-foreground/60">Git 回滚点</span>
        <input
          className="w-28 px-1.5 py-0.5 text-[10px] font-mono border border-border rounded bg-background text-muted-foreground"
          value={cwd}
          onChange={(e) => { setCwd(e.target.value); sessionStorage.setItem('rollback_cwd', e.target.value); }}
          placeholder="工作目录"
        />
      </div>

      {/* commit 列表 */}
      <div className="flex-1 overflow-auto space-y-0.5 min-h-0">
        {entries.length === 0 && !loading && (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <GitCommit size={24} strokeWidth={1} className="text-muted-foreground/30" />
            <span className="text-xs">暂无 commit</span>
          </div>
        )}
        {entries.map((e) => (
          <div
            key={e.hash}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors',
              selectedHash === e.hash ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/5'
            )}
            onClick={() => handleViewDiff(e.hash)}
          >
            <GitCommit size={12} className="shrink-0 text-muted-foreground/50" />
            <span className="font-mono text-primary shrink-0">{e.hash.slice(0, 7)}</span>
            <span className="flex-1 truncate text-foreground" title={e.message}>{e.message}</span>
            <button
              className="shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
              onClick={(ev) => { ev.stopPropagation(); handleViewDiff(e.hash); }}
              title="查看 diff"
            >
              <Eye size={12} />
            </button>
            <button
              className="shrink-0 p-0.5 rounded text-destructive/50 hover:text-destructive transition-colors"
              onClick={(ev) => { ev.stopPropagation(); handleRestore(e.hash); }}
              title="Revert"
            >
              <Undo2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* diff 预览 */}
      {diff !== null && (
        <div className="border border-border rounded-lg overflow-hidden shrink-0 max-h-48">
          <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border/50">
            <span className="text-[10px] font-mono text-muted-foreground">diff {selectedHash?.slice(0, 7)}</span>
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setDiff(null)}>关闭</button>
          </div>
          {diffLoading ? (
            <div className="p-3 text-xs text-muted-foreground">加载中…</div>
          ) : (
            <pre className="p-2 text-[10px] leading-relaxed font-mono text-muted-foreground overflow-auto max-h-36 whitespace-pre-wrap break-all">
              {diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
