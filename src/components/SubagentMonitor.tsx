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
 * 仅在存在活跃/已完成委托任务时渲染。
 *
 * 🔴 2026-08-15 修复（遮挡主聊天窗口）：原由 App 无条件挂载、弹出后无法收起；
 * 现改由 ToolStatusBar 的监控触发按钮控制开合（对齐 DSH SubagentCatalogAction），
 * 面板以抽屉形式从消息区顶部滑出覆盖；本组件头部提供 X 收起按钮
 * （onClose 可选，未提供则不渲染）。
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Bot, X, Send, ChevronDown, ChevronUp, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorDelegateTasks, type DelegateTask } from '../store/debug';
import { steerSubagent, interruptSubagent, getSubagentHistory, type SubagentHistoryMessage } from '../utils/api';
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

/** 历史消息角色标签（紧凑渲染用；未知角色回退原样显示） */
const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  tool: '工具',
  system: '系统',
};

const ROLE_CLS: Record<string, string> = {
  user: 'text-primary/90',
  assistant: 'text-foreground/90',
  tool: 'text-muted-foreground/80',
  system: 'text-muted-foreground/60',
};

/** 单页历史条数（对齐聊天软件式窗口加载） */
const HISTORY_PAGE = 30;

/** 提取消息文本（content 为字符串或多模态数组，对齐后端 conversation_row_to_value） */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (typeof b.text === 'string') return b.text as string;
          if (b.type === 'image_url') return '[图片]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

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
  // ── 对话历史（对齐 DSH subagent.history：child_session_id 回读 + 上翻分页）──
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SubagentHistoryMessage[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyOldestId, setHistoryOldestId] = useState<number | null>(null);
  const status = task.status ?? (task.eventType === 'subagent.complete' ? 'completed' : 'running');
  const isDone = status !== 'running';
  const canReadHistory = Boolean(sessionId && task.childSessionId);

  const loadHistory = useCallback(
    async (beforeId?: number) => {
      if (!canReadHistory || historyLoading) return;
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const res = await getSubagentHistory(sessionId!, task.childSessionId!, HISTORY_PAGE, beforeId);
        setHistory((prev) => {
          if (beforeId !== undefined && prev) {
            // 上翻：更早消息插前（后端游标严格 before_id 过滤，页间不重叠）
            return [...res.messages, ...prev];
          }
          return res.messages;
        });
        setHistoryHasMore(Boolean(res.has_more));
        setHistoryOldestId(res.oldest_id ?? null);
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : '历史加载失败');
      } finally {
        setHistoryLoading(false);
      }
    },
    [canReadHistory, historyLoading, sessionId, task.childSessionId],
  );

  // 首次展开时懒加载最新一页
  useEffect(() => {
    if (showHistory && history === null && !historyLoading && canReadHistory) {
      void loadHistory();
    }
  }, [showHistory, history, historyLoading, canReadHistory, loadHistory]);

  const handleSteer = useCallback(async () => {
    const text = instruction.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      // 🔴 2026-08-17 审计 E-F1（P0）：寻址键 = registry 键（子会话 id）——
      // 旧实现传 task.id（进度事件展示身份 sa-{i}-{uuid8}），后端 registry 无
      // 此键 → is_authorized_controller false → steer 恒「未送达」（监控面板
      // 对运行中子 Agent 的指令全路径失效）。ACP/降级占位无 childSessionId
      // （其 registry 键 = 展示 id）→ fallback task.id。
      const targetId = task.childSessionId || task.id;
      const res = await steerSubagent(sessionId ?? '', targetId, text);
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
  }, [instruction, sending, task.childSessionId, task.id, sessionId]);

  const handleKill = useCallback(async () => {
    try {
      // 🔴 2026-08-17 审计 E-F1（P0）：同 steer——registry 键 = 子会话 id；
      // 且消费 RPC 响应（旧实现忽略响应恒报「已发送」——ACP 占位/已结束目标
      // 返回 not_found 时是假成功）。
      const targetId = task.childSessionId || task.id;
      const res = await interruptSubagent(sessionId ?? '', targetId);
      if (res.status === 'ok' && res.interrupted !== false) {
        notifySuccess('中断请求已发送');
      } else {
        notifyError(new Error('子 Agent 已结束或不可中断（ACP 子进程不支持中断）'), '中断失败');
      }
    } catch (e) {
      notifyError(e, '中断失败');
    }
  }, [sessionId, task.childSessionId, task.id]);

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
            {/* 🔴 2026-08-17 审计 E-F4：F6 字段补全的数据已到 store，补渲染
                 token（输入/输出）与成本（F6 修复要服务的监控需求） */}
            {(task.inputTokens !== undefined || task.outputTokens !== undefined) && (
              <span className="text-[10px] text-muted-foreground/60">
                · {task.inputTokens ?? 0}→{task.outputTokens ?? 0} tok
              </span>
            )}
            {typeof task.costUsd === 'number' && task.costUsd > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                · ${task.costUsd.toFixed(4)}
              </span>
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

      {/* 对话历史（折叠；child_session_id 回读，对齐 DSH subagent.history） */}
      {canReadHistory && (
        <div className="pl-5">
          <button
            className="text-[10px] text-muted-foreground/70 hover:text-foreground flex items-center gap-1"
            onClick={() => setShowHistory((v) => !v)}
            title="查看该子 Agent 的对话历史"
          >
            {showHistory ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            <History size={11} />
            对话历史{history ? `（${history.length} 条${historyHasMore ? '+' : ''}）` : ''}
          </button>
          {showHistory && (
            <div className="mt-1 max-h-44 overflow-y-auto space-y-1 rounded bg-accent/40 p-1.5">
              {historyLoading && history === null && (
                <div className="text-[10px] text-muted-foreground/70">加载中…</div>
              )}
              {historyError && <div className="text-[10px] text-destructive/80 break-all">{historyError}</div>}
              {history && history.length === 0 && !historyLoading && (
                <div className="text-[10px] text-muted-foreground/70">无历史消息</div>
              )}
              {historyHasMore && (
                <button
                  className="w-full text-left text-[10px] text-primary/80 hover:text-primary disabled:opacity-50"
                  onClick={() => void loadHistory(historyOldestId ?? undefined)}
                  disabled={historyLoading}
                >
                  {historyLoading ? '加载中…' : '加载更早…'}
                </button>
              )}
              {history?.map((m, i) => {
                const text = messageText(m.content);
                const fallback = m.role === 'tool' && m.tool_name ? `调用 ${m.tool_name}` : '';
                const shown = text || fallback;
                if (!shown) return null;
                return (
                  <div key={i} className="text-[10px] leading-tight break-all">
                    <span className={ROLE_CLS[m.role] ?? 'text-muted-foreground'}>
                      {ROLE_LABEL[m.role] ?? m.role}：
                    </span>
                    <span className="text-muted-foreground/90 whitespace-pre-wrap">{shown}</span>
                  </div>
                );
              })}
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

/** 推导任务状态（与 TaskCard 同源：status 缺省时按 eventType 兜底） */
function taskStatus(task: DelegateTask): string {
  return task.status ?? (task.eventType === 'subagent.complete' ? 'completed' : 'running');
}

/** 任务列表 + 运行中计数：ToolStatusBar 按钮徽章与面板共用单一数据源。
 *  🔴 2026-08-17 审计 E-F3：按会话过滤——delegate.* 事件恒带父会话 sid
 *  （现已不过滤存储），面板/徽章只渲染当前会话的任务，杜绝跨会话串显；
 *  无 sessionId 的旧任务仅在没有会话上下文时显示（兼容兜底）。 */
export function useSubagentTasks(sessionId?: string | null): { tasks: DelegateTask[]; runningCount: number } {
  const rawTasks = useMonitorDelegateTasks();
  const tasks = useMemo(() => {
    const list = (Object.values(rawTasks).filter((t) => t && typeof t === 'object') as DelegateTask[])
      .filter((t) => (sessionId ? t.sessionId === sessionId : !t.sessionId));
    if (list.length === 0) return [];
    return list.slice().sort((a, b) => {
      const sa = taskStatus(a) === 'running' ? 0 : 1;
      const sb = taskStatus(b) === 'running' ? 0 : 1;
      return sa - sb;
    });
  }, [rawTasks, sessionId]);
  const runningCount = useMemo(
    () => tasks.filter((t) => taskStatus(t) === 'running').length,
    [tasks],
  );
  return { tasks, runningCount };
}

export default function SubagentMonitor({ sessionId, onClose }: { sessionId?: string | null; onClose?: () => void }) {
  const { tasks, runningCount } = useSubagentTasks(sessionId);

  if (tasks.length === 0) return null;

  return (
    <div className="px-3 py-2 space-y-2">
      {/* 头部：计数 + 收起（老大调整：去掉"子 Agent 监控"标题） */}
      <div className="flex items-center justify-end gap-2">
        <div className="text-[10px] text-muted-foreground/60">
          {runningCount} 运行中 / 共 {tasks.length}
        </div>
        {onClose && (
          <button
            className="text-muted-foreground/60 hover:text-foreground transition-colors"
            onClick={onClose}
            title="收起监控面板"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}
