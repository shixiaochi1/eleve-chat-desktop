/**
 * SubagentMonitor — 子 Agent 监控面板（③ 编排对齐，DSH list_agents/子代理视图）
 *
 * 2026-08-15 主审需求：前端对子 Agent 的监控机制——
 * ① 查看任务过程：goal / 状态 / 当前工具 / 思考首行 / 文本 delta 轨迹 /
 *    完成摘要与用量（数据源 = delegate.progress 事件 → monitor.delegateTasks，
 *    原只写不读的死状态修复）；
 * ② 与子 Agent 对话：指令输入框 → subagent.steer RPC（步边界注入，不打断
 *    当前工具，下个 tool call 边界生效——与主 Agent steer_subagent 工具同机制）；
 * ③ 逐分支 kill（复用 ToolStatusBar 的 subagent.interrupt）。
 *
 * 仅在存在活跃/已完成委托任务时渲染（App 挂在 ToolStatusBar 下方）。
 */
import { useMemo, useState, useCallback } from 'react';
import { Bot, X, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorDelegateTasks, type DelegateTask } from '../store/debug';
import { steerSubagent, interruptSubagent } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';

const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
};

const STATUS_CLS: Record<string, string> = {
  running: 'text-primary',
  completed: 'text-success',
  failed: 'text-destructive',
};

function fmtDuration(sec?: number): string {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return '';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

interface TaskCardProps {
  task: DelegateTask;
  sessionId?: string | null;
}

function TaskCard({ task, sessionId }: TaskCardProps) {
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const status = task.status ?? (task.eventType === 'subagent.complete' ? 'completed' : 'running');
  const isDone = status !== 'running';

  const handleSteer = useCallback(async () => {
    const text = instruction.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await steerSubagent(task.id, text);
      if (res.status === 'injected') {
        notifySuccess('指令已注入子 Agent（下个工具调用边界生效）');
        setInstruction('');
      } else if (res.status === 'not_found') {
        notifyError(new Error('子 Agent 已结束或不存在'), '指令未送达');
      } else {
        notifyError(new Error('空指令被拒'), '指令未送达');
      }
    } catch (e) {
      notifyError(e, '指令发送失败');
    } finally {
      setSending(false);
    }
  }, [instruction, sending, task.id]);

  const handleKill = useCallback(async () => {
    try {
      await interruptSubagent(sessionId ?? '', task.id);
      notifySuccess('中断请求已发送');
    } catch (e) {
      notifyError(e, '中断失败');
    }
  }, [sessionId, task.id]);

  return (
    <div className="rounded border border-border bg-background/60 px-2.5 py-2 space-y-1.5">
      {/* 头部：状态 + goal + 控制 */}
      <div className="flex items-start gap-2">
        <Bot size={13} className="shrink-0 mt-0.5 text-muted-foreground/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('text-[10px] font-medium', STATUS_CLS[status] ?? 'text-muted-foreground')}>
              {STATUS_LABEL[status] ?? status}
            </span>
            {isDone && task.durationSeconds !== undefined && (
              <span className="text-[10px] text-muted-foreground/60">{fmtDuration(task.durationSeconds)}</span>
            )}
            {task.toolCount !== undefined && task.toolCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60">· {task.toolCount} 工具调用</span>
            )}
            {task.apiCalls !== undefined && task.apiCalls > 0 && (
              <span className="text-[10px] text-muted-foreground/60">· {task.apiCalls} API</span>
            )}
          </div>
          <div className="text-[11px] text-foreground/90 truncate max-w-full" title={task.goal}>
            {task.goal ?? task.id}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isDone && (
            <button
              className="text-destructive/70 hover:text-destructive transition-colors"
              onClick={handleKill}
              title="中断该子 Agent"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 实时状态行 */}
      <div className="text-[10px] text-muted-foreground/80 space-y-0.5 pl-5">
        {task.thinkingText && (
          <div className="truncate" title={task.thinkingText}>💭 {task.thinkingText}</div>
        )}
        {task.toolName && !isDone && (
          <div className="truncate">🔧 当前工具：{task.toolName}</div>
        )}
        {task.lastText && (
          <div className="truncate" title={task.lastText}>💬 {task.lastText}</div>
        )}
        {isDone && task.summary && (
          <div className="text-foreground/85 line-clamp-3" title={task.summary}>✅ {task.summary}</div>
        )}
        {isDone && task.exitReason && (
          <div className="truncate text-destructive/80">退出原因：{task.exitReason}</div>
        )}
      </div>

      {/* 过程轨迹（折叠） */}
      {Array.isArray(task.trace) && task.trace.length > 0 && (
        <div className="pl-5">
          <button
            className="text-[10px] text-muted-foreground/70 hover:text-foreground flex items-center gap-1"
            onClick={() => setShowTrace((v) => !v)}
          >
            {showTrace ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            任务过程（{task.trace.length} 条）
          </button>
          {showTrace && (
            <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5 rounded bg-accent/40 p-1.5">
              {task.trace.map((line, i) => (
                <div key={i} className="text-[10px] text-muted-foreground/90 leading-tight break-all">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 对话输入（运行中可注入指令） */}
      {!isDone && (
        <div className="flex items-center gap-1 pl-5">
          <input
            className="flex-1 h-6 rounded border border-border bg-background px-1.5 text-[10px] outline-none focus:border-primary/60"
            placeholder="向该子 Agent 下达指令（下个工具调用边界生效）…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSteer();
              }
            }}
          />
          <button
            className="flex items-center gap-0.5 h-6 px-1.5 rounded text-[10px] bg-primary/90 text-background hover:bg-primary disabled:opacity-50"
            onClick={() => void handleSteer()}
            disabled={sending || !instruction.trim()}
            title="发送指令"
          >
            <Send size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function SubagentMonitor({ sessionId }: { sessionId?: string | null }) {
  const rawTasks = useMonitorDelegateTasks();
  const tasks = useMemo(() => {
    const list = Object.values(rawTasks).filter((t) => t && typeof t === 'object') as DelegateTask[];
    if (list.length === 0) return [];
    return list.slice().sort((a, b) => {
      const sa = a.status === 'running' ? 0 : 1;
      const sb = b.status === 'running' ? 0 : 1;
      return sa - sb;
    });
  }, [rawTasks]);

  if (tasks.length === 0) return null;

  return (
    <div className="border-b border-border bg-background/40 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-foreground/85">子 Agent 监控</div>
        <div className="text-[10px] text-muted-foreground/60">
          {tasks.filter((t) => (t.status ?? 'running') === 'running').length} 运行中 / 共 {tasks.length}
        </div>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}
