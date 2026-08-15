/**
 * RollbackPanel — 文件快照回滚面板
 *
 * 对齐 Hermes methods_tools.py rollback.list/diff/restore（checkpoint 系统）：
 * - 工作目录在 Agent 修改文件前自动创建快照（checkpoints）
 * - 列出快照 → 查看差异 → 一键恢复（全量恢复会同时回退对话到那一轮）
 * - 🔴 BP-3 修复：工作目录由后端从当前会话派生（Hermes _session_cwd 语义），
 *   前端只传 session_id；旧版手输 cwd + raw git revert 已移除。
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { listCheckpoints, getCheckpointDiff, restoreCheckpoint } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { ConfirmDialog } from './ui/confirm-dialog';
import { History, RefreshCw, Eye, Undo2 } from 'lucide-react';

interface CheckpointEntry {
  hash: string;
  short_hash?: string;
  timestamp?: string;
  message: string;
  files_changed?: number;
}

interface RollbackPanelProps {
  sessionId?: string | null;
  [key: string]: unknown;
}

export default function RollbackPanel({ sessionId }: RollbackPanelProps) {
  const [enabled, setEnabled] = useState(true);
  const [entries, setEntries] = useState<CheckpointEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 🔴 2026-08-16（P1 延伸统一）：恢复确认——原生 window.confirm 改应用内浮层
  const [pendingRestore, setPendingRestore] = useState<CheckpointEntry | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await listCheckpoints(sessionId);
      setEnabled(res.enabled !== false);
      setEntries(res.checkpoints || []);
    } catch (e) {
      notifyError(e, '获取快照列表失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再加载。
  // sessionId 变化（切会话）自动重拉——快照列表跟随会话工作目录。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) refresh(); })
      .catch(() => { if (!cancelled) notifyError('无法连接网关，请检查后端服务', '获取快照列表失败'); });
    return () => { cancelled = true; };
  }, [refresh]);

  const handleViewDiff = useCallback(async (hash: string) => {
    if (!sessionId) return;
    setSelectedHash(hash);
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await getCheckpointDiff(sessionId, hash);
      if (res.error) {
        setDiff(`获取差异失败: ${res.error}`);
      } else {
        const parts = [res.stat || '', res.diff || ''].filter(Boolean);
        setDiff(parts.length > 0 ? parts.join('\n\n') : '(无差异)');
      }
    } catch (e) {
      setDiff(`获取差异失败: ${(e as Error).message}`);
    } finally {
      setDiffLoading(false);
    }
  }, [sessionId]);

  const handleRestore = useCallback((entry: CheckpointEntry) => {
    if (!sessionId || restoring) return;
    // 🔴 2026-08-16（P1 延伸统一）：确认改应用内浮层（ConfirmDialog），
    //   实际恢复在 confirmRestore（浮层确认后）执行
    setPendingRestore(entry);
  }, [sessionId, restoring]);

  const confirmRestore = useCallback(async () => {
    if (!sessionId || !pendingRestore || restoring) return;
    const entry = pendingRestore;
    setPendingRestore(null);
    const label = entry.short_hash || entry.hash.slice(0, 7);
    setRestoring(true);
    try {
      const res = await restoreCheckpoint(sessionId, entry.hash);
      if (res.success) {
        notifySuccess(`已恢复到快照 ${label}`);
        setDiff(null);
        setSelectedHash(null);
        refresh();
      } else {
        notifyError(res.error || '恢复失败', '恢复失败');
      }
    } catch (e) {
      notifyError(e, '恢复失败');
    } finally {
      setRestoring(false);
    }
  }, [sessionId, pendingRestore, restoring, refresh]);

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={refresh}
          disabled={loading || !sessionId}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '加载中…' : '刷新'}
        </button>
        <span className="text-xs text-muted-foreground/60">文件快照</span>
      </div>

      {/* 未启用提示（对齐 Hermes：checkpoints.enabled=false） */}
      {!enabled && !loading && (
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <History size={24} strokeWidth={1} className="text-muted-foreground/30" />
          <span className="text-xs">快照功能未启用</span>
          <span className="text-[10px] text-muted-foreground/60 text-center leading-relaxed px-4">
            在设置中开启 checkpoints 后，Agent 修改文件前会自动创建快照
          </span>
        </div>
      )}

      {/* 快照列表 */}
      <div className="flex-1 overflow-auto space-y-0.5 min-h-0">
        {enabled && entries.length === 0 && !loading && (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <History size={24} strokeWidth={1} className="text-muted-foreground/30" />
            <span className="text-xs">暂无快照</span>
            <span className="text-[10px] text-muted-foreground/60 text-center leading-relaxed px-4">
              Agent 修改文件时会自动创建快照
            </span>
          </div>
        )}
        {entries.map((e) => {
          const label = e.short_hash || e.hash.slice(0, 7);
          return (
            <div
              key={e.hash}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors',
                selectedHash === e.hash ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/5'
              )}
              onClick={() => handleViewDiff(e.hash)}
            >
              <History size={12} className="shrink-0 text-muted-foreground/50" />
              <span className="font-mono text-primary shrink-0">{label}</span>
              <span className="flex-1 truncate text-foreground" title={e.message}>{e.message}</span>
              {typeof e.files_changed === 'number' && e.files_changed > 0 && (
                <span className="shrink-0 text-[10px] text-muted-foreground/60">{e.files_changed} 文件</span>
              )}
              <button
                className="shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                onClick={(ev) => { ev.stopPropagation(); handleViewDiff(e.hash); }}
                title="查看差异"
              >
                <Eye size={12} />
              </button>
              <button
                className="shrink-0 p-0.5 rounded text-destructive/50 hover:text-destructive transition-colors"
                onClick={(ev) => { ev.stopPropagation(); handleRestore(e); }}
                title="恢复到此快照"
                disabled={restoring}
              >
                <Undo2 size={12} />
              </button>
            </div>
          );
        })}
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

      {/* 🔴 2026-08-16（P1 延伸统一）：恢复确认浮层（取代 window.confirm——
          工作目录+对话双回退，warning 色调；busy 复用 restoring 防重复提交） */}
      <ConfirmDialog
        open={!!pendingRestore}
        title="恢复快照"
        message={pendingRestore
          ? `恢复到快照 ${pendingRestore.short_hash || pendingRestore.hash.slice(0, 7)}（${pendingRestore.message}）？\n工作目录文件将回退，对话也会回退到那一轮。`
          : ''}
        confirmLabel="确认恢复"
        tone="warning"
        busy={restoring}
        onConfirm={confirmRestore}
        onCancel={() => setPendingRestore(null)}
      />
    </div>
  );
}
