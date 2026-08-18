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
import { getLearningFrames, getLearningDetail, deleteLearning, updateLearning } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { ConfirmDialog } from './ui/confirm-dialog';
import { BookOpen, RefreshCw, Trash2, X, Pencil, Check } from 'lucide-react';

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
  // 🔴 2026-08-16（P1 延伸统一）：删除确认——原生 window.confirm 改应用内浮层
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // 🔴 2026-08-18 断线修复 + 对齐 Hermes learning.edit：内联编辑节点内容
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLearningFrames();
      // 🔴 2026-08-18 断线修复：后端 learning.frames 返回 { frames }（对齐 Hermes
      // 时间线帧命名），api.ts 已归一为 nodes；此处双键兜底防御。
      const raw = (res.nodes || (res as Record<string, unknown>).frames) as LearningNode[] | undefined;
      const list = (Array.isArray(raw) ? raw : []).sort((a, b) => b.modified - a.modified);
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
    setEditing(false);
    try {
      const res = await getLearningDetail(id);
      setDetail(res.ok ? (res.content || '(空)') : (res.error || '未找到'));
    } catch (e) {
      setDetail(`加载失败: ${(e as Error).message}`);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /** 🔴 2026-08-18 对齐 Hermes learning.edit：进入编辑模式（textarea 预填当前内容） */
  const handleStartEdit = useCallback(() => {
    if (selectedId && detail !== null) {
      setEditContent(detail === '(空)' ? '' : detail);
      setEditing(true);
    }
  }, [selectedId, detail]);

  const handleSaveEdit = useCallback(async () => {
    if (!selectedId) return;
    setEditSaving(true);
    try {
      const res = await updateLearning(selectedId, editContent);
      if (!res.ok) {
        notifyError(new Error(res.error || 'not found'), '保存失败');
        return;
      }
      notifySuccess(`已保存 ${selectedId}`);
      setDetail(editContent || '(空)');
      setEditing(false);
      refresh();
    } catch (e) {
      notifyError(e, '保存失败');
    } finally {
      setEditSaving(false);
    }
  }, [selectedId, editContent, refresh]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetail(null);
    setSelectedId(null);
    setEditing(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    // 🔴 2026-08-16（P1 延伸统一）：确认改应用内浮层（ConfirmDialog），
    //   实际删除在 confirmDelete（浮层确认后）执行
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await deleteLearning(id);
      notifySuccess(`已删除 ${id}`);
      setSelectedId(null);
      setDetail(null);
      setEditing(false);
      refresh();
    } catch (e) {
      notifyError(e, '删除失败');
    }
  }, [pendingDeleteId, refresh]);

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
            <div className="flex items-center gap-1">
              {/* 🔴 2026-08-18 对齐 Hermes learning.edit：编辑按钮（仅非编辑态显示） */}
              {!editing && (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleStartEdit}
                  title="编辑"
                  disabled={detailLoading}
                >
                  <Pencil size={12} />
                </button>
              )}
              <button className="text-muted-foreground hover:text-foreground" onClick={handleCloseDetail}>
                <X size={12} />
              </button>
            </div>
          </div>
          {detailLoading ? (
            <div className="p-3 text-xs text-muted-foreground">加载中…</div>
          ) : editing ? (
            <div className="flex flex-col gap-1.5 p-2">
              <textarea
                className="w-full h-28 resize-none rounded bg-background border border-border p-1.5 text-[10px] font-mono leading-relaxed text-foreground outline-none focus:border-accent/50"
                value={editContent}
                onChange={(ev) => setEditContent(ev.target.value)}
                spellCheck={false}
                placeholder="节点内容（Markdown）…"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-bg-hover transition-colors"
                  onClick={handleCancelEdit}
                  disabled={editSaving}
                >
                  取消
                </button>
                <button
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                >
                  <Check size={10} />
                  {editSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            <pre className="p-2 text-[10px] leading-relaxed font-mono text-muted-foreground overflow-auto max-h-44 whitespace-pre-wrap break-all">
              {detail}
            </pre>
          )}
        </div>
      )}

      {/* 🔴 2026-08-16（P1 延伸统一）：删除确认浮层（取代 window.confirm） */}
      <ConfirmDialog
        open={!!pendingDeleteId}
        title="删除学习节点"
        message={`确认删除学习节点 "${pendingDeleteId}"？`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
