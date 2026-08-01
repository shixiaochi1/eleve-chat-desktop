/**
 * LearningPanel — 学习节点面板（F4 T4.3）
 *
 * 对齐 Hermes learning.frames/detail/delete：
 * - 列出 Agent 学到的技能/记忆节点（skills 目录 .md 文件）
 * - 点击查看详情（markdown 内容）
 * - 支持删除
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { getLearningFrames, getLearningDetail, deleteLearning } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { BookOpen, RefreshCw, Trash2, X } from 'lucide-react';

interface LearningNode {
  id: string;
  modified: number;
}

interface LearningPanelProps {
  [key: string]: unknown;
}

function fmtTime(secs: number): string {
  if (!secs) return '—';
  const d = new Date(secs * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function LearningPanel(_props: LearningPanelProps) {
  const [nodes, setNodes] = useState<LearningNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLearningFrames();
      const list = (res.nodes || []).sort((a, b) => b.modified - a.modified);
      setNodes(list);
    } catch (e) {
      notifyError(e, '获取学习节点失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再加载。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) refresh(); })
      .catch(() => { if (!cancelled) notifyError('无法连接网关，请检查后端服务', '获取学习节点失败'); });
    return () => { cancelled = true; };
  }, [refresh]);

  const handleViewDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getLearningDetail(id);
      setDetail(res.ok ? (res.content || '(空)') : (res.error || '未找到'));
    } catch (e) {
      setDetail(`加载失败: ${(e as Error).message}`);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm(`确认删除学习节点 "${id}"？`)) return;
    try {
      await deleteLearning(id);
      notifySuccess(`已删除 ${id}`);
      setSelectedId(null);
      setDetail(null);
      refresh();
    } catch (e) {
      notifyError(e, '删除失败');
    }
  }, [refresh]);

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
        <span className="text-xs text-muted-foreground/60">学习节点 ({nodes.length})</span>
      </div>

      {/* 节点列表 */}
      <div className="flex-1 overflow-auto space-y-0.5 min-h-0">
        {nodes.length === 0 && !loading && (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <BookOpen size={24} strokeWidth={1} className="text-muted-foreground/30" />
            <span className="text-xs">暂无学习节点</span>
            <span className="text-[10px] text-muted-foreground/50">Agent 学习新技能后自动显示</span>
          </div>
        )}
        {nodes.map((n) => (
          <div
            key={n.id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors',
              selectedId === n.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/5'
            )}
            onClick={() => handleViewDetail(n.id)}
          >
            <BookOpen size={12} className="shrink-0 text-muted-foreground/50" />
            <span className="flex-1 truncate text-foreground font-mono" title={n.id}>{n.id}</span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0">{fmtTime(n.modified)}</span>
            <button
              className="shrink-0 p-0.5 rounded text-destructive/40 hover:text-destructive transition-colors"
              onClick={(ev) => { ev.stopPropagation(); handleDelete(n.id); }}
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* 详情预览 */}
      {detail !== null && (
        <div className="border border-border rounded-lg overflow-hidden shrink-0 max-h-56">
          <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border/50">
            <span className="text-[10px] font-mono text-muted-foreground truncate">{selectedId}</span>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => { setDetail(null); setSelectedId(null); }}>
              <X size={12} />
            </button>
          </div>
          {detailLoading ? (
            <div className="p-3 text-xs text-muted-foreground">加载中…</div>
          ) : (
            <pre className="p-2 text-[10px] leading-relaxed font-mono text-muted-foreground overflow-auto max-h-44 whitespace-pre-wrap break-all">
              {detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
