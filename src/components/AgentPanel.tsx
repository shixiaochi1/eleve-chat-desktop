/**
 * AgentPanel — 多 Agent 协作面板
 *
 * 展示当前 Agent 身份、活跃的委托子任务，
 * 支持向 running 任务发送 /steer 指令或中断。
 */
import { useState, useCallback } from 'react';
import useAgents from '../hooks/useAgents';
import { call } from '../utils/bridge';
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
  Send,
  StopCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DelegateTaskData {
  id: string;
  status: string;
  goal?: string;
  model?: string;
  tools?: string[] | string;
  depth?: number;
  duration?: number;
  summary?: string;
  eventType?: string;
  taskIndex?: number;
  taskCount?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolPreview?: string;
  thinkingText?: string;
  progressSummary?: string;
  parentId?: string;
  toolsets?: string[];
  childSessionId?: string;
  toolCount?: number;
  // 🔴 对齐Hermes complete_kwargs
  durationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  apiCalls?: number;
  filesRead?: string[];
  filesWritten?: string[];
  outputTail?: unknown[];
  costUsd?: number;
  exitReason?: string;
}

interface MonitorState {
  modelName?: string;
  delegateTasks?: Record<string, DelegateTaskData>;
}

export interface DelegateCardProps {
  task: DelegateTaskData;
  onCancel?: (taskId: string) => void;
  cancelling?: boolean;
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
export function DelegateCard({ task, onCancel, cancelling }: DelegateCardProps) {
  const isRunning = task.status === 'running';
  const isFailed = task.status === 'failed' || task.status === 'error';
  const isDone = !isRunning && !isFailed;

  return (
    <div className={cn(
      'px-2 py-1.5 rounded border border-border bg-card transition-colors space-y-1',
      isRunning && 'border-primary/30 bg-accent/[0.02]',
      isDone && 'opacity-70',
      isFailed && 'border-destructive/30 bg-destructive/[0.02]'
    )}>
      {/* 任务 ID */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50" title={`任务 ID: ${task.id}`}>
        <Hash size={10} strokeWidth={1.5} />
        <span>{task.id ? task.id.slice(0, 12) : '—'}</span>
        {/* 取消按钮 — 仅 running 状态显示 */}
        {isRunning && onCancel && (
          <button
            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={() => onCancel(task.id)}
            disabled={cancelling}
            title="中断此任务"
          >
            <StopCircle size={12} strokeWidth={1.5} className={cancelling ? 'animate-spin' : ''} />
          </button>
        )}
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

        {/* 🔴 对齐Hermes: toolsets(实际执行工具集) + toolCount(工具调用次数) */}
        {task.toolsets && task.toolsets.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="执行工具集">
            <Wrench size={10} strokeWidth={1.5} />
            <span>{task.toolsets.join(', ')}</span>
          </span>
        )}
        {task.toolCount != null && task.toolCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="工具调用次数">
            <Hash size={10} strokeWidth={1.5} />
            <span>{task.toolCount}次</span>
          </span>
        )}

        {task.depth != null && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="深度">
            <Layers size={10} strokeWidth={1.5} />
            <span>深度 {task.depth}</span>
          </span>
        )}

        {isRunning && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-primary" title="进行中">
            <Loader size={10} strokeWidth={1.5} className="animate-spin" />
            <span>进行中</span>
          </span>
        )}

        {isDone && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-success" title="已完成">
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

      {/* 运行中：推理状态 */}
      {isRunning && task.thinkingText && (
        <div className="text-[10px] text-primary/60 truncate" title={task.thinkingText}>
          💭 {task.thinkingText}
        </div>
      )}

      {/* 运行中：当前工具调用 + 参数预览 */}
      {isRunning && task.toolName && (
        <div className="flex items-center gap-1 text-[10px] text-primary/80 truncate" title={`当前工具: ${task.toolName}${task.toolArgs ? '\n参数: ' + JSON.stringify(task.toolArgs) : ''}`}>
          <Wrench size={9} strokeWidth={1.5} />
          <span className="truncate">{task.toolName}</span>
          {task.toolPreview && (
            <span className="text-muted-foreground/50 truncate" title={task.toolPreview}>
              {task.toolPreview.length > 35 ? task.toolPreview.slice(0, 35) + '…' : task.toolPreview}
            </span>
          )}
          {task.toolArgs && Object.keys(task.toolArgs).length > 0 && (
            <span className="text-muted-foreground/50 truncate">
              {Object.entries(task.toolArgs).slice(0, 2).map(([k,v]) => `${k}=${typeof v === 'string' ? v.slice(0,20) : JSON.stringify(v)?.slice(0,20)}`).join(', ')}
            </span>
          )}
        </div>
      )}

      {/* 批量进度汇总（Hermes subagent.progress） */}
      {task.progressSummary && (
        <div className="text-[10px] text-muted-foreground/70 truncate" title={task.progressSummary}>
          {task.progressSummary}
        </div>
      )}

      {/* 完成统计：token / 文件 / 费用 */}
      {(isDone || isFailed) && (task.inputTokens != null || task.outputTokens != null || task.filesRead || task.costUsd != null) && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground/60">
          {task.inputTokens != null && task.outputTokens != null && (
            <span title="Token 用量">{task.inputTokens.toLocaleString()}↓ {task.outputTokens.toLocaleString()}↑</span>
          )}
          {task.reasoningTokens != null && task.reasoningTokens > 0 && (
            <span title="推理 Token">🧠{task.reasoningTokens.toLocaleString()}</span>
          )}
          {task.filesRead && task.filesRead.length > 0 && (
            <span title="读取文件">📖{task.filesRead.length}</span>
          )}
          {task.filesWritten && task.filesWritten.length > 0 && (
            <span title="写入文件">✏️{task.filesWritten.length}</span>
          )}
          {task.costUsd != null && task.costUsd > 0 && (
            <span title="费用">${task.costUsd.toFixed(4)}</span>
          )}
        </div>
      )}

      {/* 退出原因（失败时显示） */}
      {isFailed && task.exitReason && (
        <div className="text-[10px] text-destructive/70 truncate" title={task.exitReason}>
          {task.exitReason}
        </div>
      )}

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
  sessionId?: string | null;
}

// ── 主面板 ──
export default function AgentPanel({ monitorState, sessionId }: AgentPanelProps) {
  const { mainAgent, activeDelegates, completedDelegates, totalActive, totalAll } = useAgents(monitorState!);
  const [steerText, setSteerText] = useState('');
  const [steering, setSteering] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // 发送 /steer 指令
  const handleSteer = useCallback(async () => {
    if (!steerText.trim() || !sessionId) return;
    setSteering(true);
    try {
      await call('steer_session', { session_id: sessionId, text: steerText.trim() });
      setSteerText('');
    } catch (e) {
      console.error('[AgentPanel] steer failed:', e);
    } finally {
      setSteering(false);
    }
  }, [steerText, sessionId]);

  // 中断指定委托任务
  const handleCancel = useCallback(async (taskId: string) => {
    setCancellingId(taskId);
    try {
      await call('abort_chat', { session_id: taskId });
    } catch (e) {
      console.error('[AgentPanel] cancel failed:', e);
    } finally {
      setCancellingId(null);
    }
  }, []);

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
                <span className="ml-1 px-1 py-0.5 text-[10px] rounded bg-accent/10 text-primary">{totalActive} 个活跃</span>
              )}
            </span>
          </div>

          {/* 活跃委托 */}
          {activeDelegates.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-primary">活跃中</div>
              {activeDelegates.map((t: DelegateTaskData) => (
                <DelegateCard key={t.id} task={t} onCancel={handleCancel} cancelling={cancellingId === t.id} />
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

      {/* ===== Steer 指令输入 ===== */}
      <div className="mt-auto pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
          <Send size={10} strokeWidth={1.5} />
          <span>向 Agent 发送指令</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSteer(); } }}
            placeholder={sessionId ? '输入 /steer 指令…' : '无活跃会话'}
            disabled={!sessionId || steering}
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
          />
          <button
            onClick={handleSteer}
            disabled={!steerText.trim() || !sessionId || steering}
            className="shrink-0 p-1.5 rounded text-primary hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="发送"
          >
            {steering ? <Loader size={14} strokeWidth={1.5} className="animate-spin" /> : <Send size={14} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
