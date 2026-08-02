/**
 * CronPanel — 定时任务管理（对齐 Hermes cronjob 语义）
 *
 * 定时任务 = 定时执行的 Agent 提示词任务：触发时以独立 cron:<id> 会话运行 prompt
 * （gateway_cron 执行器），不是执行 shell 命令。
 * 链路：bridge jobs.* → 后端 JobService → cronjob 工具（Job 模型 100% 对齐 Hermes）。
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';
import type { CronJob } from '@/types/eleve';
import {
  NewIcon, DeleteIcon, PlayIcon, PauseIcon,
  PencilIcon, TrashIcon, ClockIcon, HistoryIcon,
} from './Icons';

interface CronForm {
  name: string;
  schedule: string;
  prompt: string;
}

const EMPTY_FORM: CronForm = { name: '', schedule: '', prompt: '' };

// Job.state（对齐 Hermes JobState）：scheduled / paused / completed
const STATE_MAP: Record<string, { label: string; className: string }> = {
  scheduled: { label: '运行中', className: 'text-success bg-success/10' },
  paused:    { label: '已暂停', className: 'text-warning bg-warning/10' },
  completed: { label: '已完成', className: 'text-muted-foreground/60 bg-muted/30' },
};

const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
];

function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN');
}

// schedule 字段运行时兼容（类型声明为对象 {expr}，防御历史字符串形态）
function scheduleExpr(job: CronJob): string {
  const s = job.schedule as unknown;
  if (typeof s === 'string') return s;
  return job.schedule?.expr || '';
}

export default function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CronForm>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: { jobs?: CronJob[] } = await call('list_jobs', {});
      setJobs(Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError((err as Error).message);
      setJobs([]);
    }
    setLoading(false);
  }, []);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再加载。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) fetchJobs(); })
      .catch(() => { if (!cancelled) setError('无法连接网关，请检查后端服务'); });
    return () => { cancelled = true; };
  }, [fetchJobs]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.schedule.trim() || !form.prompt.trim()) return;
    const key = editingId ? `update-${editingId}` : 'create';
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = {
        name: form.name.trim(),
        schedule: form.schedule.trim(),
        prompt: form.prompt.trim(),
      };
      if (editingId) {
        await call('update_job', { id: editingId, ...payload });
      } else {
        await call('create_job', payload);
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      setShowForm(false);
      fetchJobs();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setActionLoading((prev) => ({ ...prev, [key]: false })); }
  }, [form, editingId, fetchJobs]);

  const handleDelete = useCallback(async (id: string) => {
    const key = `delete-${id}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await call('delete_job', { id });
      fetchJobs();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setActionLoading((prev) => ({ ...prev, [key]: false })); }
  }, [fetchJobs]);

  const handleTogglePause = useCallback(async (job: CronJob) => {
    const isPaused = job.state === 'paused';
    const cmd = isPaused ? 'resume_job' : 'pause_job';
    const key = `${isPaused ? 'resume' : 'pause'}-${job.id}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await call(cmd, { id: job.id });
      fetchJobs();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setActionLoading((prev) => ({ ...prev, [key]: false })); }
  }, [fetchJobs]);

  const handleRun = useCallback(async (id: string) => {
    const key = `trigger-${id}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await call('run_job', { id });
      fetchJobs();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setActionLoading((prev) => ({ ...prev, [key]: false })); }
  }, [fetchJobs]);

  const handleEdit = useCallback((job: CronJob) => {
    setForm({
      name: job.name || '',
      schedule: scheduleExpr(job),
      prompt: job.prompt || '',
    });
    setEditingId(job.id);
    setShowForm(true);
  }, []);

  const renderState = (job: CronJob) => {
    const state = job.state || (job.enabled === false ? 'paused' : 'scheduled');
    const cfg = STATE_MAP[state] || { label: state, className: 'text-muted-foreground/60 bg-muted/30' };
    return <span className={cn('px-1.5 py-0.5 text-[10px] rounded-full', cfg.className)}>{cfg.label}</span>;
  };

  return (
    <div className="p-2 space-y-2">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-1 px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">
          <span className="flex-1">{error}</span>
          <button className="p-0.5 rounded text-muted-foreground hover:bg-accent transition-colors" title="关闭" onClick={() => setError(null)}>
            <DeleteIcon size={12} />
          </button>
        </div>
      )}

      {/* 新建按钮 */}
      <button
        className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-primary border border-dashed border-primary/30 rounded-md hover:bg-accent/10 transition-colors"
        onClick={() => { setShowForm((v) => !v); if (!showForm) { setEditingId(null); setForm({ ...EMPTY_FORM }); } }}
      >
        <NewIcon size={14} />
        <span>{showForm ? '取消' : '新建任务'}</span>
      </button>

      {/* 新建 / 编辑表单 */}
      {showForm && (
        <div className="space-y-2 p-2 bg-muted/10 rounded border border-border">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">任务名称</label>
            <input className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" type="text" placeholder="例如：每日待办汇总"
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">Cron 表达式</label>
            <input className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" type="text" placeholder="0 9 * * *"
              value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
            <div className="flex gap-1 flex-wrap mt-0.5">
              {CRON_PRESETS.map((p) => (
                <button key={p.value} className="px-1.5 py-0.5 text-[10px] bg-muted/30 text-muted-foreground rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => setForm((f) => ({ ...f, schedule: p.value }))}
                >{p.label}</button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">提示词（任务内容）</label>
            <textarea className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-none" rows={3}
              placeholder="定时交给 Agent 执行的任务，例如：检查今天的待办并生成摘要"
              value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} />
            <p className="text-[10px] text-muted-foreground/50 m-0">触发时以独立会话运行此提示词（对齐 Hermes cronjob 语义）</p>
          </div>
          <div className="pt-1">
            <button className="w-full px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.schedule.trim() || !form.prompt.trim()
                || actionLoading[editingId ? `update-${editingId}` : 'create']}>
              {editingId ? '保存' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-1">
        {loading ? (
          <div className="flex flex-col items-center py-6 text-xs text-muted-foreground gap-1">加载中…</div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-xs text-muted-foreground gap-1">
            <span>暂无定时任务</span>
            <span className="text-[10px] text-muted-foreground/50">点击上方按钮创建第一个任务</span>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="p-2 rounded border border-border hover:bg-accent/10 transition-colors">
              {/* 名称 + 状态 */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-foreground truncate flex-1" title={job.name || job.id}>{job.name || job.id.slice(0, 8)}</span>
                {renderState(job)}
                {job.last_status === 'failed' && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full text-danger bg-danger/10" title={job.last_error || undefined}>上次失败</span>
                )}
              </div>
              {/* 调度：人类可读摘要 + 表达式 */}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-0.5">
                  <ClockIcon size={11} />
                  {job.schedule_display || scheduleExpr(job) || '—'}
                </span>
                {job.schedule_display && scheduleExpr(job) && (
                  <span className="font-mono text-muted-foreground/40">{scheduleExpr(job)}</span>
                )}
              </div>
              {/* 下次触发 / 上次运行 */}
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-0.5">
                  <CalendarClock size={11} />
                  下次 {formatTime(job.next_run_at)}
                </span>
                <span className="flex items-center gap-0.5">
                  <HistoryIcon size={11} />
                  上次 {formatTime(job.last_run_at)}
                </span>
              </div>
              {/* 提示词预览 */}
              {job.prompt && (
                <div className="flex items-start gap-1 mt-1 text-[10px] text-muted-foreground/50">
                  <MessageSquareText size={11} className="shrink-0 mt-px" />
                  <span className="line-clamp-2">{job.prompt}</span>
                </div>
              )}
              {/* 操作 */}
              <div className="flex items-center gap-0.5 mt-1.5 pt-1.5 border-t border-border/50">
                <button className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title="立即执行"
                  onClick={() => handleRun(job.id)} disabled={actionLoading[`trigger-${job.id}`]}>
                  <PlayIcon size={14} />
                </button>
                <button className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title={job.state === 'paused' ? '恢复' : '暂停'}
                  onClick={() => handleTogglePause(job)} disabled={actionLoading[`pause-${job.id}`] || actionLoading[`resume-${job.id}`]}>
                  {job.state === 'paused' ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
                </button>
                <button className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title="编辑"
                  onClick={() => handleEdit(job)}>
                  <PencilIcon size={14} />
                </button>
                <button className="p-0.5 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="删除"
                  onClick={() => handleDelete(job.id)} disabled={actionLoading[`delete-${job.id}`]}>
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
