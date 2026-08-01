/**
 * 任务详情抽屉 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 * 含 StatusDot / AddLinkForm / MetaRow / ActionButton（仅本文件使用）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ChevronDown, Edit3, Save, GitBranch, Paperclip, Download, Trash2,
  FileText, Radio, BellOff, Bell, Send, Play, Ban, Clock, CheckCircle2,
  ArrowLeftFromLine, Archive, Zap, Loader, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFileAsDataURL, base64FromDataURL } from '@/utils/file';
import { getWsActiveProfile } from '@/services/ws-client';
import {
  getKanbanRun, getKanbanTask, getKanbanAttachments, addKanbanComment,
  updateKanbanTask, uploadKanbanAttachment, deleteKanbanAttachment,
  deleteKanbanLink, createKanbanLink, getApiBase,
} from '@/utils/api';
import type { KanbanTask, CommentRecord, AttachmentRecord, RunRecord } from './types';
import { isBlocked, isDone, fmtAge, fmtDuration } from './helpers';

// ═══════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════

function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const s = (status || '').toLowerCase();
  const colorMap: Record<string, string> = {
    triage: 'var(--ui-purple)', todo: 'var(--ui-text-tertiary)',
    scheduled: 'var(--ui-cyan)', ready: 'var(--ui-yellow)', running: 'var(--ui-green)',
    blocked: 'var(--ui-red)', review: 'var(--ui-orange)',
    done: 'var(--ui-blue)', completed: 'var(--ui-blue)', archived: 'var(--ui-text-quaternary)',
  };
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: colorMap[s] || colorMap.todo }} />;
}

// ── 添加依赖表单 ──
function AddLinkForm({ taskId, direction, onSubmit }: { taskId: string; direction: 'parent' | 'child'; onSubmit: (id: string) => Promise<void> }) {
  const [otherId, setOtherId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const label = direction === 'parent' ? '添加上游' : '添加下游';
  const placeholder = direction === 'parent' ? '父任务 ID' : '子任务 ID';
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = otherId.trim();
    if (!id) return;
    setSubmitting(true);
    try {
      await onSubmit(id);
      setOtherId('');
    } catch {}
    setSubmitting(false);
  };
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5 mb-2">
      <span className="text-[0.7rem] text-[var(--ui-text-tertiary)] shrink-0">{label}</span>
      <input value={otherId} onChange={e => setOtherId(e.target.value)} placeholder={placeholder}
        className="flex-1 text-[0.7rem] px-2 py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
      <button type="submit" disabled={submitting || !otherId.trim()}
        className="text-[0.7rem] px-2 py-1 rounded-md border border-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <Plus size={11} strokeWidth={1.5} />
      </button>
    </form>
  );
}

// ── 详情抽屉（含评论+运行历史+附件+可编辑描述）──
interface TaskDrawerProps {
  task: KanbanTask | null;
  onClose: () => void;
  onAction: (action: string, taskId: string) => void;
  loadingId: string | null;
  onRefresh: () => void;
  onViewLog: (taskId: string) => void;
  workerLog: string | Record<string, unknown> | null;
  homeChannels: Array<{ platform?: string } | string>;
}

export function TaskDrawer({ task, onClose, onAction, loadingId, onRefresh, onViewLog, workerLog, homeChannels }: TaskDrawerProps) {
  const busy = loadingId === task?.id;
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingPriority, setEditingPriority] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null); // Phase B7: Run 详情展开
  const [expandedRunData, setExpandedRunData] = useState<RunRecord | null>(null);
  const [expandedRunLoading, setExpandedRunLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase B7: 展开/收起 Run 详情
  const handleToggleRunDetail = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setExpandedRunData(null);
      return;
    }
    setExpandedRunId(runId);
    setExpandedRunLoading(true);
    setExpandedRunData(null);
    try {
      const data = await getKanbanRun(runId);
      setExpandedRunData(data?.run || data || null);
    } catch {
      setExpandedRunData(null);
    }
    setExpandedRunLoading(false);
  }, [expandedRunId]);

  // 加载评论
  useEffect(() => {
    if (!task?.id) return;
    getKanbanTask(task.id).then(data => {
      setComments(data?.comments || []);
    }).catch(() => {});
  }, [task?.id]);

  // 加载附件
  useEffect(() => {
    if (!task?.id) return;
    getKanbanAttachments(task.id).then(data => {
      setAttachments(data?.attachments || data || []);
    }).catch(() => {});
  }, [task?.id]);

  const handleShadeClick = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const blocked = isBlocked(task);
  const done = isDone(task);
  const running = task.status === 'running';
  const scheduled = (task.status || '').toLowerCase() === 'scheduled';
  const review = (task.status || '').toLowerCase() === 'review';

  // 发送评论 → 调 addKanbanComment → 刷新评论列表
  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    try {
      await addKanbanComment(task.id, commentInput.trim(), 'user');
      setCommentInput('');
      const data = await getKanbanTask(task.id);
      setComments(data?.comments || []);
    } catch (err) {
      console.error('[KanbanPanel] Comment failed:', err);
    }
  };

  // 保存标题 → 行内编辑
  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) { setEditingTitle(false); return; }
    if (trimmed === (task.title || '')) { setEditingTitle(false); return; }
    try {
      await updateKanbanTask(task.id, { title: trimmed });
      setEditingTitle(false);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save title failed:', err);
    }
  };

  // 保存 Priority → 行内下拉
  const handleSavePriority = async (newPriority: string) => {
    setEditingPriority(false);
    const current = task.priority ? String(task.priority).replace(/^p/i, '') : '';
    if (newPriority === current) return;
    try {
      await updateKanbanTask(task.id, { priority: newPriority ? Number(newPriority) : null });
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save priority failed:', err);
    }
  };

  // 保存 Assignee → 行内编辑
  const handleSaveAssignee = async () => {
    setEditingAssignee(false);
    const trimmed = assigneeDraft.trim();
    if (trimmed === (task.assignee || '')) return;
    try {
      await updateKanbanTask(task.id, { assignee: trimmed || null });
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save assignee failed:', err);
    }
  };

  // 保存描述 → 调 updateKanbanTask → 刷新
  const handleSaveBody = async () => {
    try {
      await updateKanbanTask(task.id, { body: bodyDraft });
      setEditingBody(false);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save body failed:', err);
    }
  };

  // 上传附件 → 调 uploadKanbanAttachment → 刷新附件列表
  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      const base64 = base64FromDataURL(dataUrl);
      await uploadKanbanAttachment(task.id, file.name, base64);
      const data = await getKanbanAttachments(task.id);
      setAttachments(data?.attachments || data || []);
    } catch (err) {
      console.error('[KanbanPanel] Upload failed:', err);
    }
  };

  // Run 结果颜色
  const runBorderColor = (outcome: string | undefined): string => {
    if (['crashed','timed_out','gave_up','spawn_failed'].includes(outcome || '')) return 'var(--ui-red)';
    if (outcome === 'reclaimed') return 'var(--ui-yellow)';
    if (outcome === 'completed') return 'var(--ui-blue)';
    if (outcome === 'blocked') return 'var(--ui-red)';
    return 'var(--ui-stroke-tertiary)';
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay/40" onClick={handleShadeClick} style={{ animation: 'fadeIn 150ms ease-out' }}>
      <div className="flex flex-col h-full border-l border-[var(--kanban-col-border)] bg-[var(--color-background)]" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 88vw)', animation: 'slideInRight 180ms ease-out' }}>
        {/* 抽屉头 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ui-stroke-tertiary)]">
          <div className="flex items-center gap-2">
            <StatusDot status={task.status} size={10} />
            <span className="font-mono text-[0.8rem] text-[var(--ui-text-quaternary)]">#{typeof task.id === 'string' ? task.id.slice(0, 8) : task.id}</span>
          </div>
          <button onClick={onClose} className="text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] transition-colors p-1"><X size={18} strokeWidth={1.5} /></button>
        </div>

        {/* 标题 — 行内可编辑 */}
        <div className="px-5 pt-4 pb-2">
          {editingTitle ? (
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              onBlur={handleSaveTitle} autoFocus
              className="w-full text-base font-semibold leading-snug px-2 py-1 -mx-2 rounded-md border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
          ) : (
            <h3 onClick={() => { setEditingTitle(true); setTitleDraft(task.title || ''); }}
              className="text-base font-semibold text-[var(--ui-text-primary)] leading-snug cursor-pointer rounded-md px-2 -mx-2 py-1 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] transition-colors"
              title="点击编辑标题">
              {task.title || '(无描述)'}
            </h3>
          )}
        </div>

        {/* 抽屉体 — 折叠面板 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col">
          {/* ── 详情 ── */}
          <div>
            <button onClick={() => setCollapsedSections((prev: Record<string, boolean>) => ({...prev, details: !prev.details}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.details && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">详情</span>
            </button>
            {!collapsedSections.details && (
              <div className="py-3 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[color-mix(in_srgb,var(--ui-text-primary)_4%,transparent)] text-[0.8rem]">
                  <MetaRow label="状态" value={task.status} />
                  {/* 优先级 — 行内可编辑 */}
                  <div className="flex gap-3">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">优先级</span>
                    {editingPriority ? (
                      <select value={String(task.priority || '').replace(/^p/i, '')} autoFocus
                        onChange={(e) => handleSavePriority(e.target.value)}
                        onBlur={() => setEditingPriority(false)}
                        className="text-[var(--ui-text-primary)] bg-transparent border border-[var(--kanban-hover-bg)] rounded px-1 py-0.5 -my-0.5 text-[0.8rem] focus:outline-none cursor-pointer">
                        <option value="">—</option>
                        <option value="0">P0</option>
                        <option value="1">P1</option>
                        <option value="2">P2</option>
                        <option value="3">P3</option>
                      </select>
                    ) : (
                      <span onClick={() => setEditingPriority(true)}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑优先级">
                        {task.priority ? `P${String(task.priority).replace(/^p/i, '')}` : '—'}
                      </span>
                    )}
                  </div>
                  {/* 负责人 — 行内可编辑 */}
                  <div className="flex gap-3">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">负责人</span>
                    {editingAssignee ? (
                      <input value={assigneeDraft} onChange={(e) => setAssigneeDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAssignee(); if (e.key === 'Escape') setEditingAssignee(false); }}
                        onBlur={handleSaveAssignee} autoFocus
                        placeholder="留空自动分配"
                        className="flex-1 text-[0.8rem] px-1 py-0.5 -my-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
                    ) : (
                      <span onClick={() => { setEditingAssignee(true); setAssigneeDraft(task.assignee || ''); }}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑负责人">
                        {task.assignee || '未分配'}
                      </span>
                    )}
                  </div>
                  <MetaRow label="创建时间" value={task.startTs ? fmtAge(task.startTs) : '—'} />
                  <MetaRow label="耗时" value={task.duration ? fmtDuration(task.duration) : '—'} />
                  {blocked && task.block_reason && <MetaRow label="阻塞原因" value={task.block_reason} />}
                </div>

                {/* 描述（点击正文区域直接编辑） */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--color-muted-foreground)]">描述</span>
                    {!editingBody && task.body && (
                      <button onClick={() => { setEditingBody(true); setBodyDraft(task.body || ''); }} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
                        <Edit3 size={12} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                  {editingBody ? (
                    <div className="flex flex-col gap-2">
                      <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingBody(false); }}
                        className="w-full min-h-[6rem] text-[0.82rem] px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)]" />
                      <div className="flex gap-2">
                        <button onClick={handleSaveBody} className="inline-flex items-center gap-1 text-[0.7rem] px-2 py-1 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 transition-colors"><Save size={11} /> 保存</button>
                        <button onClick={() => setEditingBody(false)} className="text-[0.7rem] px-2 py-1 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">取消</button>
                      </div>
                    </div>
                  ) : (
                    task.body
                      ? <p onClick={() => { setEditingBody(true); setBodyDraft(task.body || ''); }}
                          className="text-[0.82rem] text-[var(--color-foreground)] leading-relaxed whitespace-pre-wrap cursor-pointer rounded px-2 py-1.5 -mx-2 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] transition-colors"
                          title="点击编辑描述">{task.body}</p>
                      : <p onClick={() => { setEditingBody(true); setBodyDraft(''); }}
                          className="text-[0.82rem] text-[var(--color-muted-foreground)] italic cursor-pointer rounded px-2 py-1.5 -mx-2 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] transition-colors"
                          title="点击添加描述">点击此处添加描述</p>
                  )}
                </div>

                {/* 概要 */}
                {task.summary && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">概要</span>
                    <p className="text-[0.82rem] text-[var(--ui-text-primary)] leading-relaxed whitespace-pre-wrap">{task.summary}</p>
                  </div>
                )}

                {/* 依赖 */}
                {(task.parents?.length > 0 || task.children?.length > 0) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">依赖关系</span>
                    <div className="flex flex-wrap gap-1.5">
                      {task.parents.map((p: string) => <span key={p} className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)]">↑ {typeof p === 'string' ? p.slice(0, 6) : p}</span>)}
                      {task.children.map((c: string) => <span key={c} className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)]">↓ {typeof c === 'string' ? c.slice(0, 6) : c}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 评论 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, comments: !prev.comments}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.comments && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">评论{comments.length > 0 ? ` (${comments.length})` : ''}</span>
            </button>
            {!collapsedSections.comments && (
              <div className="py-3 flex flex-col gap-3">
                {comments.length === 0 ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-6">暂无评论</p>
                ) : (
                  comments.map((c: CommentRecord, i: number) => (
                    <div key={i} className="border-l-2 border-[color-mix(in_srgb,var(--kanban-hover-bg)_35%,transparent)] pl-3 flex flex-col gap-0.5">
                      <div className="flex gap-2 text-[0.7rem]">
                        <span className="font-semibold text-[var(--ui-text-primary)]">{c.author || '匿名'}</span>
                        <span className="text-[var(--ui-text-tertiary)]">{c.created_at ? fmtAge(c.created_at) : ''}</span>
                      </div>
                      <p className="text-[0.8rem] text-[var(--ui-text-primary)] leading-relaxed">{c.body}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 运行历史 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, runs: !prev.runs}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.runs && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">运行</span>
            </button>
            {!collapsedSections.runs && (
              <div className="py-3 flex flex-col gap-2">
                {(!task.runs || task.runs.length === 0) ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-6">暂无运行记录</p>
                ) : (
                  task.runs.map((run: RunRecord, i: number) => (
                    <div key={i} className="border-l-2 pl-3 py-1.5 rounded-r-md bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)]"
                      style={{ borderLeftColor: runBorderColor(run.outcome || run.status) }}>
                      <div className="flex items-center gap-3 text-[0.7rem]">
                        <span className="font-mono font-semibold tracking-wide text-[var(--ui-text-primary)]">{run.outcome || run.status || '—'}</span>
                        {run.profile && <span className="text-[var(--ui-text-tertiary)]">{run.profile}</span>}
                        {run.elapsed_seconds != null && <span className="tabular-nums text-[var(--ui-text-tertiary)]">{fmtDuration(run.elapsed_seconds * 1000)}</span>}
                        {run.ended_at && <span className="ml-auto text-[var(--ui-text-tertiary)]">{fmtAge(run.ended_at)}</span>}
                        {run.id && <button onClick={() => handleToggleRunDetail(run.id!)}
                          className="text-[var(--kanban-hover-bg)] hover:text-[var(--kanban-hover-bg)] transition-colors ml-1"
                          title={expandedRunId === run.id ? '收起详情' : '查看详情'}>
                          <ChevronDown size={11} strokeWidth={1.5} className={cn('transition-transform', expandedRunId === run.id && 'rotate-180')} />
                        </button>}
                      </div>
                      {run.summary && <p className="text-[0.8rem] text-[var(--ui-text-primary)] leading-relaxed mt-1">{run.summary}</p>}
                      {run.error && <p className="text-[0.7rem] text-[var(--ui-red)] font-mono mt-0.5">{run.error}</p>}
                      {/* Phase B7: Run 展开详情 */}
                      {expandedRunId === run.id && (
                        <div className="mt-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[color-mix(in_srgb,var(--ui-text-primary)_2%,transparent)] p-2.5 space-y-1.5 text-[0.72rem]">
                          {expandedRunLoading && <span className="text-[var(--ui-text-tertiary)]">加载中...</span>}
                          {expandedRunData && (
                            <>
                              {expandedRunData.task_id && <div><span className="text-[var(--ui-text-tertiary)]">Task: </span><span className="font-mono">{expandedRunData.task_id}</span></div>}
                              {expandedRunData.assignee && <div><span className="text-[var(--ui-text-tertiary)]">Assignee: </span>{expandedRunData.assignee}</div>}
                              {expandedRunData.started_at && <div><span className="text-[var(--ui-text-tertiary)]">开始: </span>{expandedRunData.started_at}</div>}
                              {expandedRunData.ended_at && <div><span className="text-[var(--ui-text-tertiary)]">结束: </span>{expandedRunData.ended_at}</div>}
                              {expandedRunData.result != null && <div><span className="text-[var(--ui-text-tertiary)]">结果: </span><span className="font-mono text-[0.68rem] whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto block">{typeof expandedRunData.result === 'string' ? expandedRunData.result : JSON.stringify(expandedRunData.result, null, 2)}</span></div>}
                              {expandedRunData.metadata && <div><span className="text-[var(--ui-text-tertiary)]">元数据: </span><span className="font-mono text-[0.68rem] whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto block">{typeof expandedRunData.metadata === 'string' ? expandedRunData.metadata : JSON.stringify(expandedRunData.metadata, null, 2)}</span></div>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 依赖 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, links: !prev.links}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.links && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">依赖</span>
            </button>
            {!collapsedSections.links && (
              <div className="py-3 flex flex-col gap-3">
                {/* 上游依赖 (parents) */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">上游依赖（父任务）</span>
                  {(!task.parents || task.parents.length === 0) && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {task.parents?.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {task.parents.map((p: string) => (
                        <div key={p} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <span className="font-mono text-[var(--ui-text-primary)]">{typeof p === 'string' ? p.slice(0, 8) : p}</span>
                          <button onClick={async () => { try { await deleteKanbanLink(p, task.id); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 下游依赖 (children) */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">下游依赖（子任务）</span>
                  {(!task.children || task.children.length === 0) && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {task.children?.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {task.children.map((c: string) => (
                        <div key={c} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <span className="font-mono text-[var(--ui-text-primary)]">{typeof c === 'string' ? c.slice(0, 8) : c}</span>
                          <button onClick={async () => { try { await deleteKanbanLink(task.id, c); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 添加依赖 */}
                <div className="border-t border-[var(--ui-stroke-tertiary)] pt-2.5">
                  <AddLinkForm taskId={task.id} direction="parent" onSubmit={async (otherId: string) => { await createKanbanLink(otherId, task.id); onRefresh(); }} />
                  <AddLinkForm taskId={task.id} direction="child" onSubmit={async (otherId: string) => { await createKanbanLink(task.id, otherId); onRefresh(); }} />
                </div>
              </div>
            )}
          </div>

          {/* ── 附件 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, attachments: !prev.attachments}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.attachments && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">附件{attachments.length > 0 ? ` (${attachments.length})` : ''}</span>
            </button>
            {!collapsedSections.attachments && (
              <div className="py-3 flex flex-col gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-dashed border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] hover:border-[var(--kanban-hover-bg)] transition-colors self-start">
                  <Paperclip size={11} /> 上传附件
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUploadAttachment} />
                {attachments.length === 0 ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-4">暂无附件</p>
                ) : (
                  attachments.map((a: AttachmentRecord, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[0.8rem] px-3 py-2 rounded border border-[var(--ui-stroke-tertiary)]">
                      <Paperclip size={12} className="shrink-0 text-[var(--ui-text-tertiary)]" />
                      <span className="truncate text-[var(--ui-text-primary)]">{a.filename || a.name || `附件 ${i + 1}`}</span>
                      {a.size && <span className="text-[0.65rem] text-[var(--ui-text-quaternary)] ml-auto">{(a.size / 1024).toFixed(1)}KB</span>}
                      <button onClick={() => { const base = getApiBase(); const p = getWsActiveProfile(); const prefix = p ? `/p/${p}` : ''; window.open(`${base}${prefix}/api/kanban/attachments/${a.id}?board=default`, '_blank'); }} title="下载附件"
                        className="text-[var(--kanban-hover-bg)] hover:text-[var(--kanban-hover-bg)] transition-colors ml-1"><Download size={11} strokeWidth={1.5} /></button>
                      <button onClick={async () => { try { await deleteKanbanAttachment(a.id!); const data = await getKanbanAttachments(task.id); setAttachments(data?.attachments || data || []); } catch {} }} title="删除附件"
                        className="text-danger/70 hover:text-danger transition-colors ml-1"><Trash2 size={11} /></button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 日志 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, log: !prev.log}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.log && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">日志</span>
            </button>
            {!collapsedSections.log && (
              <div className="py-3 flex flex-col gap-2">
                <button onClick={() => onViewLog?.(task.id)} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors self-start">
                  <FileText size={11} /> 加载日志
                </button>
                {workerLog && (
                  <pre className="text-[0.7rem] font-mono leading-relaxed p-3 rounded-md bg-[color-mix(in_srgb,var(--ui-text-primary)_4%,transparent)] border border-[var(--ui-stroke-tertiary)] overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-[var(--ui-text-primary)]">
                    {typeof workerLog === 'string' ? workerLog : JSON.stringify(workerLog, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* ── 订阅 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, subscribe: !prev.subscribe}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.subscribe && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">订阅</span>
            </button>
            {!collapsedSections.subscribe && (
              <div className="py-3 flex flex-col gap-3">
                <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">状态变更时推送通知到指定频道</p>
                {homeChannels.length > 0 ? (
                  homeChannels.map((ch, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[0.8rem] px-3 py-2 rounded border border-[var(--ui-stroke-tertiary)]">
                      <Radio size={12} className="text-[var(--kanban-hover-bg)]" />
                      <span className="text-[var(--ui-text-primary)]">{typeof ch === 'string' ? ch : String((ch as Record<string, unknown>).platform ?? ch)}</span>
                      <button onClick={() => onAction('unsubscribe', task.id)} className="ml-auto text-danger/70 hover:text-danger transition-colors"><BellOff size={13} /></button>
                    </div>
                  ))
                ) : (
                  <button onClick={() => onAction('subscribe', task.id)} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] transition-colors self-start">
                    <Bell size={12} /> 订阅微信通知
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 评论输入框（评论区展开时显示） */}
        {!collapsedSections.comments && (
          <div className="flex gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
            <input value={commentInput} onChange={(e) => setCommentInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder="输入评论..." className="flex-1 text-[0.8rem] px-3 py-1.5 rounded border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
            <button onClick={handleSendComment} disabled={!commentInput.trim()} className={cn('p-2 rounded-md transition-colors', commentInput.trim() ? 'text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]' : 'text-[var(--ui-text-quaternary)] pointer-events-none')}>
              <Send size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* 操作栏 — 对齐 Hermes 生命周期语义 */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
          {/* triage/todo → 推进到 Ready（由 dispatcher 自动 claim 启动） */}
          {!running && !done && !blocked && !scheduled && !review && (
            <ActionButton icon={Play} label="推进" color="accent" onClick={() => onAction('promote', task.id)} busy={busy} />
          )}
          {/* blocked/scheduled → 恢复到 Ready */}
          {(blocked || scheduled) && (
            <ActionButton icon={Play} label="恢复" color="accent" onClick={() => onAction('unblock', task.id)} busy={busy} />
          )}
          {/* ready → 可阻塞/滞留 */}
          {!running && !done && !blocked && !scheduled && !review && task.status === 'ready' && (
            <>
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
              <ActionButton icon={Clock} label="滞留" color="muted" onClick={() => onAction('schedule', task.id)} busy={busy} />
            </>
          )}
          {running && (
            <>
              <ActionButton icon={CheckCircle2} label="完成" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
              <ActionButton icon={Clock} label="滞留" color="muted" onClick={() => onAction('schedule', task.id)} busy={busy} />
              <ActionButton icon={ArrowLeftFromLine} label="回收" color="muted" onClick={() => onAction('reclaim', task.id)} busy={busy} />
            </>
          )}
          {/* review → 通过(done) / 阻塞 */}
          {review && (
            <>
              <ActionButton icon={CheckCircle2} label="通过" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
            </>
          )}
          {done && (
            <>
              <ActionButton icon={Archive} label="归档" color="muted" onClick={() => onAction('archive', task.id)} busy={busy} />
              <ActionButton icon={Trash2} label="删除" color="red" onClick={() => onAction('delete', task.id)} busy={busy} />
            </>
          )}
          {/* 分解/指定/重分配 */}
          {!done && (
            <>
              <ActionButton icon={GitBranch} label="分解" color="muted" onClick={() => onAction('decompose', task.id)} busy={busy} />
              <ActionButton icon={Zap} label="指定" color="accent" onClick={() => onAction('specify', task.id)} busy={busy} />
              <ActionButton icon={Radio} label="重分配" color="muted" onClick={() => { onAction('reassign', task.id); }} busy={busy} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">{label}</span>
      <span className="text-[var(--ui-text-primary)] break-words">{value}</span>
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, onClick, busy }: { icon: React.FC<{ size?: number; strokeWidth?: number }>; label: string; color: string; onClick: () => void; busy: boolean }) {
  const colorMap: Record<string, string> = {
    accent: 'text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] border-[var(--kanban-hover-bg)]',
    green: 'text-success hover:bg-success/10 border-success/25',
    amber: 'text-warning hover:bg-warning/10 border-warning/25',
    red: 'text-danger hover:bg-danger/10 border-danger/25',
    muted: 'text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] border-[var(--ui-stroke-tertiary)]',
  };
  return (
    <button disabled={busy} onClick={onClick} className={cn('inline-flex items-center gap-1.5 text-[0.75rem] px-2.5 py-1.5 rounded-md border transition-colors', colorMap[color] || colorMap.muted, busy && 'opacity-50 pointer-events-none')}>
      {busy ? <Loader size={12} strokeWidth={1.5} className="animate-spin" /> : <Icon size={12} strokeWidth={1.5} />}
      <span>{label}</span>
    </button>
  );
}
