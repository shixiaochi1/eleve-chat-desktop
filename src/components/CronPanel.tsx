/**
 * CronPanel — 定时任务管理（对齐 Hermes cronjob 语义 + 桌面前端 apps/desktop/src/app/cron）
 *
 * 定时任务 = 定时执行的 Agent 提示词任务：触发时以独立 cron:<id> 会话运行 prompt
 * （gateway_cron 执行器），结果可投递到指定平台（deliver）。
 * 链路：bridge jobs.* → 后端 JobService（per-profile）→ cronjob 工具（完整 Job 模型）。
 *
 * 新建表单五字段（对齐 Hermes）：名称 / 频率 / 执行时间 / 提示词 / 发送到。
 * 频率用时间段预设（每天/工作日/每周/每月/每小时/每15分钟/自定义）+ 独立时间选择器，
 * 不直接暴露裸 cron；发送到对齐 Hermes deliver（此桌面/Telegram/Discord/Slack/飞书/微信）。
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, MessageSquareText, SearchIcon, SendIcon, RefreshCwIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';
import type { CronJob } from '@/types/eleve';
// 🔴 2026-09-01 收敛：格式化实现统一到 utils/time（本处保留 null/NaN 业务兜底）
import { formatShortDateTime } from '../utils/time';
import {
  NewIcon, DeleteIcon, PlayIcon, PauseIcon,
  PencilIcon, TrashIcon, ClockIcon, HistoryIcon,
} from './Icons';

// ── 类型与常量 ────────────────────────────────────────────────────────────────
interface CronForm {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
}

const EMPTY_FORM: CronForm = { name: '', schedule: '0 9 * * *', prompt: '', deliver: 'local' };

// Job.state（对齐 Hermes JobState）：scheduled / paused / completed
const STATE_MAP: Record<string, { label: string; chip: string; dot: string; pulse?: boolean }> = {
  scheduled: { label: '运行中', chip: 'text-success bg-success/10 border-success/20', dot: 'bg-success', pulse: true },
  paused:    { label: '已暂停', chip: 'text-warning bg-warning/10 border-warning/20', dot: 'bg-warning' },
  completed: { label: '已完成', chip: 'text-muted-foreground/70 bg-muted/40 border-[var(--ui-stroke-tertiary)]', dot: 'bg-muted-foreground/50' },
};

// 频率预设（对齐 Hermes SCHEDULE_OPTIONS：时间段细分，非裸 cron）
interface ScheduleOption { expr?: string; value: string; }
const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { value: 'daily' },
  { value: 'weekdays' },
  { value: 'weekly' },
  { value: 'monthly' },
  { value: 'hourly' },
  { value: 'every-15-minutes' },
  { value: 'custom' },
];
const SCHEDULE_LABELS: Record<string, string> = {
  daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月',
  hourly: '每小时', 'every-15-minutes': '每 15 分钟', custom: '自定义',
};
// 需要单独选执行时间的频率档位
const TIME_PRESETS = new Set(['daily', 'weekdays', 'weekly', 'monthly']);

const DAY_NAMES: Record<string, string> = {
  '0': '周日', '7': '周日', '1': '周一', '2': '周二', '3': '周三',
  '4': '周四', '5': '周五', '6': '周六',
};

// 发送到（对齐 Hermes deliver；平台取 ELEVE 实际有的 platform crate）
const DELIVER_OPTIONS = [
  { value: 'local', label: '此桌面' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'feishu', label: '飞书' },
  { value: 'weixin', label: '微信' },
];
const deliverLabel = (v: string | null | undefined) =>
  DELIVER_OPTIONS.find((o) => o.value === v)?.label || v || '此桌面';

// ── cron 表达式工具 ──────────────────────────────────────────────────────────
function cronParts(expr: string): string[] | null {
  const parts = expr.trim().replace(/\s+/g, ' ').split(' ');
  return parts.length === 5 ? parts : null;
}
function isIntegerToken(v: string): boolean {
  return /^\d+$/.test(v);
}
function pad2(v: string | number): string {
  return String(v).padStart(2, '0');
}
function formatCronTime(minute: string, hour: string): string {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return `${hour}:${minute}`;
  return `${pad2(h)}:${pad2(m)}`;
}

// 频率 + 时间 → cron 表达式（分 时 日 月 周）
function buildCron(preset: string, time: string): string {
  const [hh = '9', mm = '0'] = time.split(':');
  const h = parseInt(hh, 10) || 0;
  const m = parseInt(mm, 10) || 0;
  switch (preset) {
    case 'daily': return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly': return `${m} ${h} * * 1`;
    case 'monthly': return `${m} ${h} 1 * *`;
    case 'hourly': return '0 * * * *';
    case 'every-15-minutes': return '*/15 * * * *';
    default: return '';
  }
}

// cron 表达式 → { 频率, 时间 }（编辑回填用，对齐 Hermes scheduleOptionForExpr）
function parseExpr(expr: string): { preset: string; time: string } {
  const custom = { preset: 'custom', time: '09:00' };
  const parts = cronParts(expr);
  if (!parts) return custom;
  const [minute, hour, dom, month, dow] = parts;
  const time = (isIntegerToken(hour) && isIntegerToken(minute)) ? `${pad2(hour)}:${pad2(minute)}` : '09:00';
  if (dom === '*' && month === '*' && dow === '*' && isIntegerToken(minute) && isIntegerToken(hour)) return { preset: 'daily', time };
  if (dom === '*' && month === '*' && dow === '1-5' && isIntegerToken(minute) && isIntegerToken(hour)) return { preset: 'weekdays', time };
  if (dom === '*' && month === '*' && isIntegerToken(dow) && isIntegerToken(minute) && isIntegerToken(hour)) return { preset: 'weekly', time };
  if (month === '*' && dow === '*' && isIntegerToken(dom) && isIntegerToken(minute) && isIntegerToken(hour)) return { preset: 'monthly', time };
  if (hour === '*' && dom === '*' && month === '*' && dow === '*' && isIntegerToken(minute)) return { preset: 'hourly', time: '09:00' };
  if (expr.trim().replace(/\s+/g, ' ') === '*/15 * * * *') return { preset: 'every-15-minutes', time: '09:00' };
  return custom;
}

// 频率 + 表达式 → 人类可读摘要（"每天 14:30"）
function scheduleSummary(preset: string, expr: string): string {
  const parts = cronParts(expr);
  if (!parts) return '';
  const [minute, hour, dom, , dow] = parts;
  const time = formatCronTime(minute, hour);
  switch (preset) {
    case 'daily': return `每天 ${time}`;
    case 'weekdays': return `工作日 ${time}`;
    case 'weekly': return `每${DAY_NAMES[dow] ?? `周${dow}`} ${time}`;
    case 'monthly': return `每月 ${dom} 日 ${time}`;
    case 'hourly': return minute === '0' ? '每小时整点' : `每小时 ${pad2(minute)} 分`;
    case 'every-15-minutes': return '每 15 分钟';
    default: return '';
  }
}

function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : formatShortDateTime(d);
}

// schedule 字段运行时兼容（类型声明为对象 {expr}，防御历史字符串形态）
function scheduleExpr(job: CronJob): string {
  const s = job.schedule as unknown;
  if (typeof s === 'string') return s;
  return job.schedule?.expr || '';
}
function jobScheduleText(job: CronJob): string {
  const expr = scheduleExpr(job);
  return scheduleSummary(parseExpr(expr).preset, expr);
}
function matchesQuery(job: CronJob, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [job.name || '', job.prompt || '', scheduleExpr(job), jobScheduleText(job), deliverLabel(job.deliver)]
    .some((v) => v.toLowerCase().includes(needle));
}

// ── 组件 ─────────────────────────────────────────────────────────────────────
export default function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CronForm>({ ...EMPTY_FORM });
  const [schedulePreset, setSchedulePreset] = useState('daily');
  const [timeValue, setTimeValue] = useState('09:00');
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

  // 🔴 冷启动竞态修复：mount 时 WS 可能未连，等连接后再加载。
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
    setTimeValue('09:00');
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }, []);

  const handlePresetChange = useCallback((value: string) => {
    setSchedulePreset(value);
    if (value === 'custom') {
      // 切到自定义：当前表达式若不是自定义形态则清空待输入
      setForm((f) => ({ ...f, schedule: parseExpr(f.schedule).preset !== 'custom' ? '' : f.schedule }));
    } else {
      setForm((f) => ({ ...f, schedule: buildCron(value, timeValue) }));
    }
  }, [timeValue]);

  const handleTimeChange = useCallback((t: string) => {
    setTimeValue(t);
    setForm((f) => ({ ...f, schedule: buildCron(schedulePreset, t) }));
  }, [schedulePreset]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.schedule.trim() || !form.prompt.trim()) return;
    const key = editingId ? `update-${editingId}` : 'create';
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = {
        name: form.name.trim(),
        schedule: form.schedule.trim(),
        prompt: form.prompt.trim(),
        deliver: form.deliver || 'local',
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
    const parsed = parseExpr(expr);
    setForm({
      name: job.name || '',
      schedule: expr,
      prompt: job.prompt || '',
      deliver: job.deliver || 'local',
    });
    setSchedulePreset(parsed.preset);
    setTimeValue(parsed.time);
    setEditingId(job.id);
    setShowForm(true);
  }, []);

  const isCustom = schedulePreset === 'custom';
  const needsTime = TIME_PRESETS.has(schedulePreset);
  const liveSummary = isCustom ? '' : scheduleSummary(schedulePreset, form.schedule);
  const visibleJobs = jobs.filter((j) => matchesQuery(j, query.trim()));
  const runningCount = jobs.filter((j) => (j.state || 'scheduled') === 'scheduled').length;

  const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring/50 transition-colors';
  const labelCls = 'text-[10px] font-medium tracking-wide text-muted-foreground/80';

  return (
    <div className="p-2.5 space-y-2.5">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-destructive bg-destructive/8 rounded-md border border-destructive/25">
          <span className="flex-1">{error}</span>
          <button className="p-0.5 rounded text-destructive/60 hover:text-destructive transition-colors" title="关闭" onClick={() => setError(null)}>
            <DeleteIcon size={12} />
          </button>
        </div>
      )}

      {/* 统计行（活气：运行中呼吸灯） */}
      {jobs.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">{jobs.length} 个任务</span>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 tabular-nums">
            <span className={cn('h-1.5 w-1.5 rounded-full', runningCount > 0 ? 'bg-success animate-pulse' : 'bg-muted-foreground/30')} />
            {runningCount} 运行中
          </span>
        </div>
      )}

      {/* 新建按钮 */}
      <button
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-all duration-200 active:scale-[0.98]
          bg-primary/10 text-primary border border-dashed border-primary/40 hover:bg-primary/20 hover:border-primary/60"
        onClick={() => { if (showForm) { setShowForm(false); } else { openCreate(); } }}
      >
        <NewIcon size={14} className={cn('transition-transform duration-200', showForm && 'rotate-45')} />
        <span>{showForm ? '收起' : '新建定时任务'}</span>
      </button>

      {/* 新建 / 编辑表单 */}
      {showForm && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/20 border border-[var(--ui-stroke-tertiary)] shadow-sm">
          <div className="text-[11px] font-semibold text-foreground">{editingId ? '编辑任务' : '新建任务'}</div>

          {/* 名称 */}
          <div className="space-y-1">
            <label className={labelCls}>名称</label>
            <input className={inputCls} type="text" placeholder="例如：每日待办汇总"
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>

          {/* 频率 + 执行时间 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>频率</label>
              <select className={inputCls} value={schedulePreset} onChange={(e) => handlePresetChange(e.target.value)}>
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{SCHEDULE_LABELS[o.value] ?? o.value}</option>
                ))}
              </select>
            </div>
            {needsTime && (
              <div className="space-y-1">
                <label className={labelCls}>执行时间</label>
                <input className={cn(inputCls, 'tabular-nums')} type="time" value={timeValue}
                  onChange={(e) => handleTimeChange(e.target.value)} />
              </div>
            )}
          </div>

          {/* 自定义 cron 输入（仅自定义档）/ 实时摘要预览 */}
          {isCustom ? (
            <div className="space-y-1">
              <label className={labelCls}>Cron 表达式</label>
              <input className={cn(inputCls, 'font-mono')} type="text" placeholder="0 9 * * *"
                value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
              <p className="text-[10px] text-muted-foreground/50 m-0">5 段：分 时 日 月 周</p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md bg-primary/8 border border-primary/15 px-2.5 py-1.5">
              <ClockIcon size={11} className="text-primary/70 shrink-0" />
              <span className="text-[11px] font-medium text-foreground">{liveSummary}</span>
            </div>
          )}

          {/* 提示词 */}
          <div className="space-y-1">
            <label className={labelCls}>提示词</label>
            <textarea className={cn(inputCls, 'resize-none leading-relaxed')} rows={3}
              placeholder="定时交给 Agent 执行的任务，例如：检查今天的待办并生成摘要"
              value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} />
            <p className="text-[10px] text-muted-foreground/50 m-0">到达执行时间后，会自动开启一个独立会话来运行这段提示词</p>
          </div>

          {/* 发送到 */}
          <div className="space-y-1">
            <label className={labelCls}>发送到</label>
            <div className="relative">
              <SendIcon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              <select className={cn(inputCls, 'pl-7')} value={form.deliver}
                onChange={(e) => setForm((f) => ({ ...f, deliver: e.target.value }))}>
                {DELIVER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-muted-foreground/50 m-0">任务结果将发送到所选目的地；未配置的平台可能无法送达</p>
          </div>

          <button
            className="w-full px-3 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-sm"
            onClick={handleSave}
            disabled={!form.name.trim() || !form.schedule.trim() || !form.prompt.trim()
              || actionLoading[editingId ? `update-${editingId}` : 'create']}>
            {editingId ? '保存修改' : '创建任务'}
          </button>
        </div>
      )}

      {/* 搜索 + 刷新 */}
      {jobs.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input className={cn(inputCls, 'pl-7')} type="text" placeholder="搜索任务…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="p-1.5 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-95"
            title="刷新" onClick={() => fetchJobs()} disabled={loading}>
            <RefreshCwIcon size={12} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-1.5">
        {loading && jobs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-xs text-muted-foreground gap-1.5">
            <RefreshCwIcon size={16} className="animate-spin text-muted-foreground/50" />
            加载中…
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center gap-1.5">
            <CalendarClock size={24} className="text-muted-foreground/30" />
            <span className="text-xs text-muted-foreground/70">{jobs.length === 0 ? '暂无定时任务' : '无匹配任务'}</span>
            <span className="text-[10px] text-muted-foreground/40">{jobs.length === 0 ? '让 Agent 按时自动为你工作' : '换个关键词试试'}</span>
          </div>
        ) : (
          visibleJobs.map((job) => {
            const expr = scheduleExpr(job);
            const summary = jobScheduleText(job);
            const st = STATE_MAP[job.state || ''] || { label: job.state || '—', chip: 'text-muted-foreground/70 bg-muted/40 border-[var(--ui-stroke-tertiary)]', dot: 'bg-muted-foreground/50' };
            return (
              <div key={job.id}
                className="group relative rounded-lg border border-[var(--ui-stroke-tertiary)] bg-card/40 p-2.5 transition-all duration-200 hover:border-primary/40 hover:bg-accent/25 hover:shadow-md hover:-translate-y-px">
                {/* 名称 + 状态 */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', st.dot, st.pulse && 'animate-pulse')} />
                  <span className="text-[13px] font-semibold text-foreground truncate flex-1 leading-tight" title={job.name || job.id}>
                    {job.name || (job.id || '').slice(0, 8)}
                  </span>
                  <span className={cn('px-1.5 py-0.5 text-[9px] font-medium rounded-full border leading-none', st.chip)}>{st.label}</span>
                  {job.last_status === 'error' && (
                    <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-full border border-danger/25 text-danger bg-danger/10 leading-none"
                      title={job.last_error || undefined}>上次失败</span>
                  )}
                </div>

                {/* 调度 + 发送到 */}
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground/70">
                  <span className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5">
                    <ClockIcon size={10} className="text-muted-foreground/60" />
                    <span className="font-medium text-foreground/80">{summary || job.schedule_display || expr || '—'}</span>
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground/60">
                    <SendIcon size={10} />
                    {deliverLabel(job.deliver)}
                  </span>
                </div>

                {/* 下次 / 上次 */}
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/60 tabular-nums">
                  <span className="flex items-center gap-1">
                    <CalendarClock size={10} />
                    下次 {formatTime(job.next_run_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HistoryIcon size={10} />
                    上次 {formatTime(job.last_run_at)}
                  </span>
                </div>

                {/* 提示词预览 */}
                {job.prompt && (
                  <div className="mt-1.5 pl-2 border-l-2 border-primary/25 text-[10px] text-muted-foreground/60 leading-relaxed line-clamp-2">
                    {job.prompt}
                  </div>
                )}

                {/* 操作（悬停增强） */}
                <div className="flex items-center gap-0.5 mt-2 pt-1.5 border-t border-[var(--ui-stroke-quaternary)] opacity-70 group-hover:opacity-100 transition-opacity">
                  <button className="p-1 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition-all active:scale-90" title="立即执行"
                    onClick={() => handleRun(job.id)} disabled={actionLoading[`trigger-${job.id}`]}>
                    <PlayIcon size={13} />
                  </button>
                  <button className="p-1 rounded text-muted-foreground hover:text-warning hover:bg-warning/10 transition-all active:scale-90" title={job.state === 'paused' ? '恢复' : '暂停'}
                    onClick={() => handleTogglePause(job)} disabled={actionLoading[`pause-${job.id}`] || actionLoading[`resume-${job.id}`]}>
                    {job.state === 'paused' ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
                  </button>
                  <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-all active:scale-90" title="编辑"
                    onClick={() => handleEdit(job)}>
                    <PencilIcon size={13} />
                  </button>
                  <span className="flex-1" />
                  <button className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all active:scale-90" title="删除"
                    onClick={() => setPendingDelete(job)} disabled={actionLoading[`delete-${job.id}`]}>
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 删除确认 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]" onClick={() => setPendingDelete(null)}>
          <div className="w-72 p-4 rounded-xl border border-[var(--ui-stroke-tertiary)] bg-background shadow-2xl space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center h-7 w-7 rounded-full bg-destructive/10 text-destructive"><TrashIcon size={13} /></span>
              <span className="text-xs font-semibold text-foreground">删除定时任务</span>
            </div>
            <p className="text-[11px] text-muted-foreground m-0 leading-relaxed">
              确定删除「<span className="text-foreground font-medium">{pendingDelete.name || (pendingDelete.id || '').slice(0, 8)}</span>」吗？删除后将停止调度，无法恢复。
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="px-3 py-1.5 text-[11px] rounded-md border border-[var(--ui-stroke-tertiary)] text-foreground hover:bg-accent transition-colors active:scale-95"
                onClick={() => setPendingDelete(null)} disabled={actionLoading[`delete-${pendingDelete.id}`]}>
                取消
              </button>
              <button className="px-3 py-1.5 text-[11px] font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors active:scale-95 disabled:opacity-50"
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
