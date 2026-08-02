/**
 * CronPanel — 定时任务管理（对齐 Hermes cronjob 语义 + 桌面前端 apps/desktop/src/app/cron）
 *
 * 定时任务 = 定时执行的 Agent 提示词任务：触发时以独立 cron:<id> 会话运行 prompt
 * （gateway_cron 执行器），不是执行 shell 命令。
 * 链路：bridge jobs.* → 后端 JobService（per-profile）→ cronjob 工具（完整 Job 模型）。
 *
 * 调度 UX 对齐 Hermes：不让用户手敲裸 cron 表达式，而是把时间段拆成
 * 每天/工作日/每周/每月/每小时/每15分钟/自定义 预设 + 人类可读摘要（"每天 09:00"），
 * 仅"自定义"才回退到 cron 输入框（Hermes CronEditorDialog 同款设计）。
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, MessageSquareText, SearchIcon } from 'lucide-react';
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

// ── 调度预设（对齐 Hermes SCHEDULE_OPTIONS：时间段细分，非裸 cron）────────────
interface ScheduleOption { expr?: string; value: string; }

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { expr: '0 9 * * *', value: 'daily' },
  { expr: '0 9 * * 1-5', value: 'weekdays' },
  { expr: '0 9 * * 1', value: 'weekly' },
  { expr: '0 9 1 * *', value: 'monthly' },
  { expr: '0 * * * *', value: 'hourly' },
  { expr: '*/15 * * * *', value: 'every-15-minutes' },
  { value: 'custom' },
];

const SCHEDULE_LABELS: Record<string, string> = {
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月',
  hourly: '每小时',
  'every-15-minutes': '每 15 分钟',
  custom: '自定义',
};

const DAY_NAMES: Record<string, string> = {
  '0': '周日', '7': '周日', '1': '周一', '2': '周二', '3': '周三',
  '4': '周四', '5': '周五', '6': '周六',
};

function cronParts(expr: string): string[] | null {
  const parts = expr.trim().replace(/\s+/g, ' ').split(' ');
  return parts.length === 5 ? parts : null;
}

function isIntegerToken(v: string): boolean {
  return /^\d+$/.test(v);
}

function formatCronTime(minute: string, hour: string): string {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return `${hour}:${minute}`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 表达式 → 预设 反向映射（对齐 Hermes scheduleOptionForExpr，编辑时回填下拉用）
function scheduleOptionForExpr(expr: string): ScheduleOption {
  const normalized = expr.trim().replace(/\s+/g, ' ');
  const exact = SCHEDULE_OPTIONS.find((o) => o.expr === normalized);
  if (exact) return exact;
  const custom = SCHEDULE_OPTIONS[SCHEDULE_OPTIONS.length - 1];
  const parts = cronParts(normalized);
  if (!parts) return custom;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const find = (v: string) => SCHEDULE_OPTIONS.find((o) => o.value === v) ?? custom;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isIntegerToken(minute) && isIntegerToken(hour)) return find('daily');
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5' && isIntegerToken(minute) && isIntegerToken(hour)) return find('weekdays');
  if (dayOfMonth === '*' && month === '*' && isIntegerToken(dayOfWeek) && isIntegerToken(minute) && isIntegerToken(hour)) return find('weekly');
  if (month === '*' && dayOfWeek === '*' && isIntegerToken(dayOfMonth) && isIntegerToken(minute) && isIntegerToken(hour)) return find('monthly');
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isIntegerToken(minute)) return find('hourly');
  if (normalized === '*/15 * * * *') return find('every-15-minutes');
  return custom;
}

// 预设 + 表达式 → 人类可读摘要（对齐 Hermes scheduleSummary："每天 09:00"）
function scheduleSummary(option: ScheduleOption, expr: string): string {
  const parts = cronParts(expr);
  if (!parts) return '';
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const time = formatCronTime(minute, hour);
  switch (option.value) {
    case 'daily': return `每天 ${time}`;
    case 'weekdays': return `工作日 ${time}`;
    case 'weekly': return `每${DAY_NAMES[dayOfWeek] ?? `周${dayOfWeek}`} ${time}`;
    case 'monthly': return `每月 ${dayOfMonth} 日 ${time}`;
    case 'hourly': return minute === '0' ? '每小时整点' : `每小时 ${minute.padStart(2, '0')} 分`;
    case 'every-15-minutes': return '每 15 分钟';
    default: return '';
  }
}

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

// 任务的调度人类可读摘要（列表展示用，后端 schedule_display 对 cron 只是表达式本身）
function jobScheduleText(job: CronJob): string {
  const expr = scheduleExpr(job);
  return scheduleSummary(scheduleOptionForExpr(expr), expr);
}

function matchesQuery(job: CronJob, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [job.name || '', job.prompt || '', scheduleExpr(job), jobScheduleText(job)]
    .some((v) => v.toLowerCase().includes(needle));
}

export default function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CronForm>({ ...EMPTY_FORM });
  const [schedulePreset, setSchedulePreset] = useState('daily');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<CronJob | null>(null);

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

  const openCreate = useCallback(() => {
    setEditingId(null);
    setSchedulePreset('daily');
    setForm({ ...EMPTY_FORM, schedule: SCHEDULE_OPTIONS[0].expr || '' });
    setShowForm(true);
  }, []);

  const handlePresetChange = useCallback((value: string) => {
    setSchedulePreset(value);
    const option = SCHEDULE_OPTIONS.find((o) => o.value === value);
    if (option?.expr) {
      setForm((f) => ({ ...f, schedule: option.expr || '' }));
    } else {
      // 切到自定义：若当前表达式不是自定义形态则清空待用户输入
      setForm((f) => ({ ...f, schedule: scheduleOptionForExpr(f.schedule).value !== 'custom' ? '' : f.schedule }));
    }
  }, []);

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
      setPendingDelete(null);
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
    const expr = scheduleExpr(job);
    setForm({
      name: job.name || '',
      schedule: expr,
      prompt: job.prompt || '',
    });
    setSchedulePreset(scheduleOptionForExpr(expr).value);
    setEditingId(job.id);
    setShowForm(true);
  }, []);

  const renderState = (job: CronJob) => {
    const state = job.state || (job.enabled === false ? 'paused' : 'scheduled');
    const cfg = STATE_MAP[state] || { label: state, className: 'text-muted-foreground/60 bg-muted/30' };
    return <span className={cn('px-1.5 py-0.5 text-[10px] rounded-full', cfg.className)}>{cfg.label}</span>;
  };

  const selectedOption = SCHEDULE_OPTIONS.find((o) => o.value === schedulePreset) ?? SCHEDULE_OPTIONS[0];
  const scheduleHint = scheduleSummary(selectedOption, form.schedule);
  const visibleJobs = jobs.filter((j) => matchesQuery(j, query.trim()));

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
        onClick={() => { if (showForm) { setShowForm(false); } else { openCreate(); } }}
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

          {/* 执行频率：时间段预设下拉（对齐 Hermes，不直接暴露裸 cron） */}
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/70">执行频率</label>
            <select
              className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={schedulePreset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{SCHEDULE_LABELS[o.value] ?? o.value}</option>
              ))}
            </select>
            {schedulePreset === 'custom' ? (
              <>
                <input
                  className="w-full px-2 py-1 text-xs font-mono bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                  type="text" placeholder="0 9 * * *"
                  value={form.schedule}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground/50 m-0">5 段 cron 表达式：分 时 日 月 周</p>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/30">
                <span className="text-[11px] font-medium text-foreground">{scheduleHint}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{form.schedule}</span>
              </div>
            )}
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

      {/* 搜索（对齐 Hermes matchesQuery） */}
      {jobs.length > 0 && (
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            className="w-full pl-6 pr-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            type="text" placeholder="搜索任务…"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-1">
        {loading ? (
          <div className="flex flex-col items-center py-6 text-xs text-muted-foreground gap-1">加载中…</div>
        ) : visibleJobs.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-xs text-muted-foreground gap-1">
            <span>{jobs.length === 0 ? '暂无定时任务' : '无匹配任务'}</span>
            <span className="text-[10px] text-muted-foreground/50">{jobs.length === 0 ? '点击上方按钮创建第一个任务' : '换个关键词试试'}</span>
          </div>
        ) : (
          visibleJobs.map((job) => {
            const expr = scheduleExpr(job);
            const summary = jobScheduleText(job);
            return (
              <div key={job.id} className="p-2 rounded border border-border hover:bg-accent/10 transition-colors">
                {/* 名称 + 状态 */}
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs text-foreground truncate flex-1" title={job.name || job.id}>{job.name || (job.id || '').slice(0, 8)}</span>
                  {renderState(job)}
                  {job.last_status === 'error' && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full text-danger bg-danger/10" title={job.last_error || undefined}>上次失败</span>
                  )}
                </div>
                {/* 调度：人类可读摘要 + 表达式 */}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                  <span className="flex items-center gap-0.5">
                    <ClockIcon size={11} />
                    {summary || job.schedule_display || expr || '—'}
                  </span>
                  {summary && expr && (
                    <span className="font-mono text-muted-foreground/40">{expr}</span>
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
                    onClick={() => setPendingDelete(job)} disabled={actionLoading[`delete-${job.id}`]}>
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 删除确认（对齐 Hermes deleteConfirm，防误删） */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingDelete(null)}>
          <div className="w-72 p-3 rounded-lg border border-border bg-background shadow-lg space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-medium text-foreground">删除定时任务</div>
            <p className="text-[11px] text-muted-foreground m-0">
              确定删除「<span className="text-foreground font-medium">{pendingDelete.name || (pendingDelete.id || '').slice(0, 8)}</span>」吗？删除后无法恢复。
            </p>
            <div className="flex justify-end gap-1.5 pt-1">
              <button className="px-2.5 py-1 text-[11px] rounded border border-border text-foreground hover:bg-accent transition-colors"
                onClick={() => setPendingDelete(null)} disabled={actionLoading[`delete-${pendingDelete.id}`]}>
                取消
              </button>
              <button className="px-2.5 py-1 text-[11px] rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                onClick={() => handleDelete(pendingDelete.id)} disabled={actionLoading[`delete-${pendingDelete.id}`]}>
                {actionLoading[`delete-${pendingDelete.id}`] ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
