/**
 * AgentPanel — 多 Agent 协作面板
 *
 * 展示当前 Agent 身份、活跃的委托子任务，
 * 通过 SSE 被动更新，无手动 spawn 操作。
 */
import useAgents from '../hooks/useAgents';
import {
  Bot,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Loader,
  Hash,
  Wrench,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DelegateTaskData {
  id: string;
  status: string;
  goal?: string;
  model?: string;
  tools?: string[] | string;
  depth?: number;
  duration?: number;
  summary?: string;
}

interface MonitorState {
  modelName?: string;
  delegateTasks?: Record<string, DelegateTaskData>;
}

interface DelegateCardProps {
  task: DelegateTaskData;
}

// ── 格式化时长 ──
function fmtDuration(durationSec: number | null | undefined): string | null {
  if (durationSec == null) return null;
  const sec = Math.floor(durationSec);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (min < 60) return `${min}分${remainSec}秒`;
  const hour = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hour}时${remainMin}分`;
}

// ── 单条委托任务卡片 ──
function DelegateCard({ task }: DelegateCardProps) {
  const isRunning = task.status === 'running';
  const isFailed = task.status === 'failed' || task.status === 'error';
  const isDone = !isRunning && !isFailed;

  return (
    <div className={cn(
      'px-2 py-1.5 rounded border border-border bg-card transition-colors space-y-1',
      isRunning && 'border-accent/30 bg-accent/[0.02]',
      isDone && 'opacity-70',
      isFailed && 'border-destructive/30 bg-destructive/[0.02]'
    )}>
      {/* 任务 ID */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50" title={`任务 ID: ${task.id}`}>
        <Hash size={10} strokeWidth={1.5} />
        <span>{task.id ? task.id.slice(0, 12) : '—'}</span>
      </div>

      {/* 目标 */}
      <div className="text-xs text-foreground truncate" title={task.goal}>
        {task.goal || '(无描述)'}
      </div>

      {/* 元信息行 */}
      <div className="flex flex-wrap items-center gap-1">
        {task.model && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="模型">
            <Bot size={10} strokeWidth={1.5} />
            <span>{task.model}</span>
          </span>
        )}

        {task.tools && task.tools.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="工具集">
            <Wrench size={10} strokeWidth={1.5} />
            <span>{Array.isArray(task.tools) ? task.tools.join(', ') : task.tools}</span>
          </span>
        )}

        {task.depth != null && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="深度">
            <Layers size={10} strokeWidth={1.5} />
            <span>深度 {task.depth}</span>
          </span>
        )}

        {isRunning && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-accent" title="进行中">
            <Loader size={10} strokeWidth={1.5} className="animate-spin" />
            <span>进行中</span>
          </span>
        )}

        {isDone && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-green-500" title="已完成">
            <CheckCircle2 size={10} strokeWidth={1.5} />
            <span>完成</span>
          </span>
        )}

        {isFailed && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive" title="失败">
            <XCircle size={10} strokeWidth={1.5} />
            <span>失败</span>
          </span>
        )}

        {(isDone || isFailed) && task.duration != null && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="耗时">
            <Clock size={10} strokeWidth={1.5} />
            <span>{fmtDuration(task.duration)}</span>
          </span>
        )}
      </div>

      {/* 概要 */}
      {task.summary && (
        <div className="text-[10px] text-muted-foreground/70 truncate" title={task.summary}>
          {task.summary}
        </div>
      )}
    </div>
  );
}

// ── 空状态 ──
function EmptyState() {
  return (
    <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
      <Users size={32} strokeWidth={1} className="text-muted-foreground/20" />
      <span className="text-xs">暂无活跃的委托任务</span>
      <span className="text-[10px] text-muted-foreground/50">Agent 在需要时会自动委派子任务</span>
    </div>
  );
}

interface AgentPanelProps {
  monitorState?: MonitorState;
}

// ── 主面板 ──
export default function AgentPanel({ monitorState }: AgentPanelProps) {
  const { mainAgent, activeDelegates, completedDelegates, totalActive, totalAll } = useAgents(monitorState!);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* ===== 当前 Agent 身份 ===== */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Bot size={13} strokeWidth={1.5} />
          <span>当前 Agent</span>
        </div>
        <div className="rounded border border-border bg-card p-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">模型</span>
            <span className="text-foreground">{mainAgent.model || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">提供方</span>
            <span className="text-foreground">{mainAgent.provider || '—'}</span>
          </div>
        </div>
      </div>

      {/* ===== 委托任务概览 ===== */}
      {totalAll > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Users size={13} strokeWidth={1.5} />
            <span>
              委托任务
              {totalActive > 0 && (
                <span className="ml-1 px-1 py-0.5 text-[10px] rounded bg-accent/10 text-accent">{totalActive} 个活跃</span>
              )}
            </span>
          </div>

          {/* 活跃委托 */}
          {activeDelegates.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-accent">活跃中</div>
              {activeDelegates.map((t: DelegateTaskData) => (
                <DelegateCard key={t.id} task={t} />
              ))}
            </div>
          )}

          {/* 已完成委托 */}
          {completedDelegates.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">已完成 ({completedDelegates.length})</div>
              {completedDelegates.map((t: DelegateTaskData) => (
                <DelegateCard key={t.id} task={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 空状态 ===== */}
      {totalAll === 0 && <EmptyState />}
    </div>
  );
}
