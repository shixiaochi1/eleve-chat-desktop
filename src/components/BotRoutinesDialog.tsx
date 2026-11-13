/**
 * BotRoutinesDialog — 某个 bot 的「例程」面板（对齐 Hermes `plugins/hermes-bots/cron.tsx`）。
 *
 * 语义（Hermes 原文）：
 * - 例程 = 该 bot profile 的 cron 任务，名字命名空间化 `[bot:<profile>] <title>`；
 * - `cron.manage {action:'list', include_disabled:true, profile}` 按 profile 取
 *   该 bot 自己的 cron 存储；回执带 `scoped` = 作用域被尊重，缺省时客户端回落到
 *   `[bot:<name>]` 标签过滤（旧网关兼容）；
 * - 创建时 `deliver='bot-chat:<profile>'`——到点把提示词作为**入站轮**投进该 bot
 *   的 canonical Bot Chat，跑一轮完整 agent turn，结果就落在私聊里（ELEVE 原生
 *   投递，因此不需要 Hermes 那段 `hermes -p <bot> chat …` 委派包装）；
 * - 暂停/恢复/删除走 `pause`/`resume`/`remove`，`name` 传 job_id（Hermes 同款）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, Pause, Play, Plus, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { call } from '../utils/bridge';

interface RoutineJob {
  job_id?: string;
  name?: string;
  schedule?: string;
  prompt_preview?: string;
  next_run_at?: number | null;
  last_run_at?: number | null;
  last_status?: string | null;
  enabled?: boolean;
  state?: string;
  paused_reason?: string | null;
}

interface RoutineListResult {
  jobs?: RoutineJob[];
  scoped?: string;
}

/** `[bot:<profile>] ` 前缀（profile 按字面量匹配，避免正则注入）。 */
function tagPrefix(profile: string): string {
  return `[bot:${profile}]`;
}

export function routineBotTag(profile: string): string {
  return tagPrefix(profile).toLowerCase();
}

/** 从任务名里剥掉 `[bot:<profile>] ` 命名空间，得到人类可读标题。 */
export function routineTitle(name: string | undefined, profile: string): string {
  const raw = (name || '').trim();
  const prefix = tagPrefix(profile);
  if (raw.toLowerCase().startsWith(prefix.toLowerCase())) {
    return raw.slice(prefix.length).trim() || '未命名例程';
  }
  return raw.replace(/^\[bot:[a-z0-9][a-z0-9_-]*\]\s*/i, '').trim() || '未命名例程';
}

/** 列表归属：`scoped` 命中 = 整份都是该 bot 的；否则按 `[bot:<name>]` 标签过滤。 */
export function selectRoutineJobs(
  data: RoutineListResult | undefined,
  profile: string,
): RoutineJob[] {
  const jobs = Array.isArray(data?.jobs) ? data!.jobs! : [];
  const scoped = (data?.scoped || '').trim().toLowerCase();
  if (scoped && scoped === profile.trim().toLowerCase()) return jobs;
  return jobs.filter((job) =>
    (job.name || '').trim().toLowerCase().startsWith(tagPrefix(profile).toLowerCase()),
  );
}

function timestamp(value: number | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(job: RoutineJob): { text: string; tone: string } {
  if (job.enabled === false || job.state === 'paused') {
    return { text: '已暂停', tone: 'text-muted-foreground' };
  }
  switch (job.last_status) {
    case 'ok':
      return { text: '上次成功', tone: 'text-emerald-500' };
    case 'error':
      return { text: '上次失败', tone: 'text-destructive' };
    case 'delivery_failed':
      return { text: '投递失败', tone: 'text-destructive' };
    case 'delivery_unverified':
      return { text: '投递未确认', tone: 'text-amber-500' };
    default:
      return { text: job.state === 'scheduled' ? '待运行' : job.state || '—', tone: 'text-muted-foreground' };
  }
}

const inputCls =
  'w-full rounded-md border border-[var(--ui-stroke-quaternary)] bg-card px-2 py-1.5 text-xs outline-none focus:border-[var(--ui-stroke-secondary)]';

/** cronjob 工具失败时是 `{success:false, error}`（而非 RPC 错误）——转成异常。 */
function ensureOk<T extends { success?: boolean; error?: string }>(data: T): T {
  if (data && data.success === false) {
    throw new Error(data.error || '例程操作失败');
  }
  return data;
}

export default function BotRoutinesDialog({
  profile,
  open,
  onClose,
}: {
  profile: string;
  open: boolean;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<RoutineJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState('every 1d');
  const [instruction, setInstruction] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const data = ensureOk(
        (await call('cron_manage', {
          action: 'list',
          include_disabled: true,
          profile,
        })) as RoutineListResult & { success?: boolean; error?: string },
      );
      setJobs(selectRoutineJobs(data, profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const sorted = useMemo(
    () => [...jobs].sort((a, b) => (b.last_run_at ?? 0) - (a.last_run_at ?? 0)),
    [jobs],
  );

  const toggle = async (job: RoutineJob) => {
    const id = job.job_id;
    if (!id) return;
    setBusyId(id);
    try {
      const paused = job.enabled === false || job.state === 'paused';
      ensureOk(
        await call('cron_manage', {
          action: paused ? 'resume' : 'pause',
          name: id,
          profile,
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      ensureOk(await call('cron_manage', { action: 'remove', name: id, profile }));
      setPendingDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    const t = title.trim();
    const p = instruction.trim();
    const s = schedule.trim();
    if (!t || !p || !s) {
      setError('例程名、时间表与指令都不能为空');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      ensureOk(
        await call('cron_manage', {
          action: 'add',
          // Hermes：任务名带 `[bot:<profile>] ` 命名空间（面板按它归属）
          name: `${tagPrefix(profile)} ${t}`,
          schedule: s,
          // Hermes：同名 profile 直接跑指令；ELEVE 用 bot-chat 投递原生完成
          // "落到该 bot 自己的历史"，因此不需要委派包装。
          prompt: p,
          deliver: `bot-chat:${profile}`,
          profile,
        }),
      );
      setTitle('');
      setInstruction('');
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlarmClock size={14} /> 例程
          </DialogTitle>
          <DialogDescription className="text-xs">
            到点让 <span className="font-medium text-foreground">@{profile}</span> 在自己的 Bot
            Chat 里跑一轮完整对话，结果作为普通回复出现。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {loading ? '加载中…' : `${jobs.length} 个例程`}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-[var(--ui-stroke-quaternary)] bg-card hover:bg-accent/50"
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus size={13} /> 新建
          </button>
        </div>

        {showCreate && (
          <div className="space-y-2 rounded-md border border-[var(--ui-stroke-quaternary)] p-2">
            <input
              className={inputCls}
              placeholder="例程名（如：每日简报）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="时间表（every 1d / every 30m / 0 9 * * * / once in 2h）"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
            <textarea
              className={`${inputCls} min-h-16 resize-y`}
              placeholder="到点要它做什么（作为一轮用户消息投进 Bot Chat）"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="h-7 px-2 text-xs rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={creating}
                className="h-7 px-2.5 text-xs rounded-md bg-foreground text-background disabled:opacity-50"
                onClick={() => void create()}
              >
                {creating ? '创建中…' : '创建例程'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="text-[11px] text-destructive break-words">{error}</div>}

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {!loading && jobs.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              还没有例程。点「新建」让它按时自己开工。
            </div>
          )}
          {sorted.map((job) => {
            const id = job.job_id || '';
            const paused = job.enabled === false || job.state === 'paused';
            const st = statusLabel(job);
            return (
              <div
                key={id}
                className="rounded-md border border-[var(--ui-stroke-quaternary)] px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{routineTitle(job.name, profile)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{job.schedule || '—'}</span>
                      <span className={st.tone}>{st.text}</span>
                      <span>下次 {timestamp(job.next_run_at)}</span>
                      <span>上次 {timestamp(job.last_run_at)}</span>
                    </div>
                    {job.prompt_preview && (
                      <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground/80">
                        {job.prompt_preview}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title={paused ? '恢复' : '暂停'}
                      disabled={busyId === id}
                      className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-50"
                      onClick={() => void toggle(job)}
                    >
                      {paused ? <Play size={12} /> : <Pause size={12} />}
                    </button>
                    {pendingDelete === id ? (
                      <button
                        type="button"
                        disabled={busyId === id}
                        className="h-6 px-1.5 text-[10px] rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
                        onClick={() => void remove(id)}
                      >
                        确认删除
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="删除"
                        className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50"
                        onClick={() => setPendingDelete(id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
