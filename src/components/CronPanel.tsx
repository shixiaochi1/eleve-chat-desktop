/**
 * CronPanel — 定时任务管理
 * Apple 风格，lucide 图标，适配 260px 面板
 * 
 * v2: 所有 API 调用走 bridge.call()，不再直接 fetch
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import type { CronJob } from '@/types/eleve';
import {
  NewIcon, DeleteIcon, PlayIcon, PauseIcon,
  PencilIcon, TrashIcon, ClockIcon,
  TerminalIcon, HistoryIcon,
} from './Icons';

interface CronJobUI extends Omit<CronJob, 'schedule' | 'name' | 'last_run_at'> {
  command?: string;
  description?: string;
  status?: string;
  schedule?: string;
  name?: string;
  last_run_at?: string;
}

interface CronForm {
  name: string;
  schedule: string;
  command: string;
  description: string;
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active:    { label: '运行中', className: 'text-green-500 bg-green-500/10' },
  paused:    { label: '已暂停', className: 'text-amber-500 bg-amber-500/10' },
  completed: { label: '已完成', className: 'text-muted-foreground/60 bg-muted/30' },
  failed:    { label: '失败',   className: 'text-red-500 bg-red-500/10' },
};

const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
];

const EMPTY_FORM: CronForm = { name: '', schedule: '', command: '', description: '' };

export default function CronPanel() {
  const [jobs, setJobs] = useState<CronJobUI[]>([]);
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
      const data: { jobs?: CronJobUI[] } = await call('list_jobs', {});
      setJobs(Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError((err as Error).message);
      setJobs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.schedule.trim()) return;
    const key = editingId ? `update-${editingId}` : 'create';
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      if (editingId) {
        await call('update_job', { id: editingId, ...form });
      } else {
        await call('create_job', { ...form });
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

  const handleTogglePause = useCallback(async (job: CronJobUI) => {
    const isPaused = job.status === 'paused';
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
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setActionLoading((prev) => ({ ...prev, [key]: false })); }
  }, []);

  const handleEdit = useCallback((job: CronJobUI) => {
    setForm({ name: job.name || '', schedule: job.schedule || '', command: job.command || '', description: job.description || '' });
    setEditingId(job.id);
    setShowForm(true);
  }, []);

  const formatTime = (ts: string | null | undefined): string => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN');
    } catch { return ts; }
  };

  const renderStatus = (status: string | undefined) => {
    const cfg = STATUS_MAP[status || ''] || { label: status || '未知', className: 'text-muted-foreground/60 bg-muted/30' };
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
        className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-accent border border-dashed border-accent/30 rounded-md hover:bg-accent/10 transition-colors"
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
            <input className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" type="text" placeholder="例如：每日备份"
              value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">Cron 表达式</label>
            <input className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" type="text" placeholder="0 * * * *"
              value={form.schedule} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
            <div className="flex gap-1 flex-wrap mt-0.5">
              {CRON_PRESETS.map((p) => (
                <button key={p.value} className="px-1.5 py-0.5 text-[10px] bg-muted/30 text-muted-foreground rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => setForm((f) => ({ ...f, schedule: p.value }))}
                >{p.label}</button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">命令 (可选)</label>
            <input className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" type="text" placeholder="要执行的命令"
              value={form.command} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, command: e.target.value }))} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">描述 (可选)</label>
            <textarea className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-none" placeholder="可选描述" rows={2}
              value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="pt-1">
            <button className="w-full px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.schedule.trim()
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
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-foreground truncate flex-1" title={job.description || job.name}>{job.name}</span>
                {renderStatus(job.status)}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-0.5">
                  <ClockIcon size={11} />
                  {job.schedule || '—'}
                </span>
                <span className="flex items-center gap-0.5">
                  <HistoryIcon size={11} />
                  {formatTime(job.last_run_at)}
                </span>
              </div>
              {job.command && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/50 font-mono">
                  <TerminalIcon size={11} />
                  {job.command}
                </div>
              )}
              <div className="flex items-center gap-0.5 mt-1.5 pt-1.5 border-t border-border/50">
                <button className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title="立即执行"
                  onClick={() => handleRun(job.id)} disabled={actionLoading[`trigger-${job.id}`]}>
                  <PlayIcon size={14} />
                </button>
                <button className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" title={job.status === 'paused' ? '恢复' : '暂停'}
                  onClick={() => handleTogglePause(job)} disabled={actionLoading[`pause-${job.id}`] || actionLoading[`resume-${job.id}`]}>
                  {job.status === 'paused' ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
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
