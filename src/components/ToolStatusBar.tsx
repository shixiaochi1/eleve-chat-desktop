/**
 * ToolStatusBar — 聊天区顶部状态栏（F2 T2.3）
 *
 * 展示委托（子 Agent）运行状态 + 暂停/恢复/中断控制。
 * 对齐 Hermes delegation.pause / delegation.status / subagent.interrupt。
 * 仅在 streaming 或有活跃子 Agent 时显示控制按钮。
 *
 * 🔴 2026-08-15 子 Agent 监控开合（老大需求，对齐 DSH SubagentCatalogAction）：
 * 状态栏内放监控触发按钮——DSH 同款 StateDot 像素追逐动画点（有子 Agent
 * 运行时）+ 计数 + 旋转 chevron；点击后监控面板以抽屉形式从消息区顶部
 * （状态栏下缘）向下滑出、覆盖消息区（position:absolute，不挤压布局）。
 * 新任务到达（runningCount 0→>0）自动展开抽屉。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getDelegationStatus, setDelegationPause, interruptSubagent, type ActiveSubagent } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { Pause, Play, Square, Bot, X, ChevronDown } from 'lucide-react';
import SubagentMonitor, { useSubagentTasks } from './SubagentMonitor';
import StateDot from './StateDot';

interface ToolStatusBarProps {
  sessionId?: string | null;
  isStreaming?: boolean;
  /** 🔴 2026-08-02 老大需求：双击空白处 → 切宫格模式 */
  onToggleViewMode?: () => void;
}

export default function ToolStatusBar({ sessionId, isStreaming, onToggleViewMode }: ToolStatusBarProps) {
  const [paused, setPaused] = useState(false);
  const [hasSubagents, setHasSubagents] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeSubagents, setActiveSubagents] = useState<ActiveSubagent[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 🔴 2026-08-15 监控面板开合：按钮在状态栏内，新任务到达自动展开
  const { tasks: monitorTasks, runningCount } = useSubagentTasks();
  const [monitorOpen, setMonitorOpen] = useState(false);
  const prevRunningRef = useRef(0);
  useEffect(() => {
    if (runningCount > 0 && prevRunningRef.current === 0) setMonitorOpen(true);
    prevRunningRef.current = runningCount;
  }, [runningCount]);
  // 对齐 DSH：抽屉打开时 Escape 关闭
  useEffect(() => {
    if (!monitorOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMonitorOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [monitorOpen]);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await getDelegationStatus(sessionId);
      setPaused(res.paused);
      setHasSubagents(res.has_subagents);
      setRunning(res.running);
      setActiveSubagents(res.active ?? []);
    } catch {
      // 静默
    }
  }, [sessionId]);

  // streaming 时 3s 轮询委托状态
  useEffect(() => {
    if (!isStreaming || !sessionId) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    poll();
    timerRef.current = setInterval(poll, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming, sessionId, poll]);

  const handleTogglePause = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await setDelegationPause(sessionId, !paused);
      setPaused(res.paused);
      notifySuccess(res.paused ? '委托已暂停' : '委托已恢复');
    } catch (e) {
      notifyError(e, '操作失败');
    }
  }, [sessionId, paused]);

  const handleInterrupt = useCallback(async () => {
    if (!sessionId) return;
    try {
      await interruptSubagent(sessionId);
      notifySuccess('子 Agent 已中断');
      poll();
    } catch (e) {
      notifyError(e, '中断失败');
    }
  }, [sessionId, poll]);

  // 🔴 P2-2（2026-08-10 对齐 Hermes TUI spawn tree 逐分支 kill）：按 subagent_id 精准中断单个
  const handleKillSubagent = useCallback(async (subagentId: string) => {
    if (!sessionId) return;
    try {
      await interruptSubagent(sessionId, subagentId);
      notifySuccess('子 Agent 已中断');
      poll();
    } catch (e) {
      notifyError(e, '中断失败');
    }
  }, [sessionId, poll]);

  // 无活跃子 Agent 且非 streaming → 显示简洁标题
  const showControls = hasSubagents || (isStreaming && running);
  // 监控按钮：有任务记录即可开合（含已完成任务回看）
  const hasMonitorTasks = monitorTasks.length > 0;

  return (
    <>
      <div
        className="flex items-center h-10 px-4 border-b border-border gap-2"
        title={onToggleViewMode ? '双击空白处切换宫格模式' : undefined}
        onDoubleClick={(e) => {
          // 🔴 2026-08-02 老大需求：双击顶部工具状态栏空白处 → 切宫格（排除按钮区）
          if ((e.target as HTMLElement).closest('button')) return;
          onToggleViewMode?.();
        }}
      >
        <Bot size={14} className={cn('shrink-0', hasSubagents ? 'text-primary' : 'text-muted-foreground/40')} />
        <span className="text-xs text-muted-foreground/60">
          {hasSubagents
            ? (paused ? '委托已暂停' : '子 Agent 运行中')
            : isStreaming
              ? 'Agent 运行中'
              : '就绪'}
        </span>

        {/* 🔴 2026-08-15 子 Agent 监控触发按钮（对齐 DSH SubagentCatalogAction trigger：
            StateDot 像素追逐动画点 + 计数 + chevron；点击弹出顶部抽屉）。
            老大调整：按钮右移（ml-auto）、文案"子Agent（个数）"。 */}
        {hasMonitorTasks && (
          <button
            type="button"
            className={cn(
              'ml-auto flex items-center gap-[3px] min-h-[28px] px-1 rounded-md bg-transparent text-[12px] leading-[18px] cursor-pointer transition-colors',
              monitorOpen ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
            )}
            aria-haspopup="true"
            aria-expanded={monitorOpen}
            onClick={() => setMonitorOpen((v) => !v)}
            title={monitorOpen ? '收起子 Agent 监控' : '展开子 Agent 监控'}
          >
            <span className="inline-flex flex-none w-2.5 h-2.5">
              <StateDot running={runningCount > 0} />
            </span>
            <span className="mx-[5px]">
              子Agent（{monitorTasks.length}）
            </span>
            <ChevronDown
              size={14}
              className={cn('transition-transform duration-150', monitorOpen && 'rotate-180')}
            />
          </button>
        )}

        {showControls && (
          <div className="flex items-center gap-1 ml-auto">
            {/* 🔴 P2-2（2026-08-10 对齐 Hermes spawn tree）：活跃子 Agent 列表 + 逐分支 kill */}
            {activeSubagents.length > 0 && (
              <div className="flex items-center gap-1 max-w-[45%] overflow-x-auto">
                {activeSubagents.map((sa) => (
                  <span
                    key={sa.subagent_id}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/60 text-[10px] text-muted-foreground whitespace-nowrap"
                    title={`${sa.goal || sa.subagent_id}${sa.interrupt_message ? `（中断请求：${sa.interrupt_message}）` : ''}`}
                  >
                    <span className="max-w-[110px] truncate">
                      {sa.current_tool ?? (sa.goal ? sa.goal.slice(0, 12) : sa.subagent_id)}
                    </span>
                    <button
                      className="text-destructive/70 hover:text-destructive transition-colors"
                      onClick={() => handleKillSubagent(sa.subagent_id)}
                      title="中断该子 Agent"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
                paused
                  ? 'text-success hover:bg-success/10'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              onClick={handleTogglePause}
              title={paused ? '恢复委托' : '暂停委托'}
            >
              {paused ? <Play size={11} /> : <Pause size={11} />}
              {paused ? '恢复' : '暂停'}
            </button>
            {hasSubagents && (
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={handleInterrupt}
                title="中断子 Agent"
              >
                <Square size={11} /> 中断
              </button>
            )}
          </div>
        )}
      </div>
      {/* 🔴 2026-08-15 监控抽屉：从状态栏底边向下滑出、覆盖消息区。
          clip 层自状态栏底边（top:40px）开始且 overflow:hidden——抽屉收起时
          上滑被裁剪在状态栏底边处（视觉锚定"从底边弹出/收回"，而非窗口顶边）。
          老大调整：鼠标离开抽屉自动收起。 */}
      {hasMonitorTasks && (
        <div className="subagent-drawer-clip">
          <div
            className={cn('subagent-drawer', monitorOpen && 'subagent-drawer-open')}
            onMouseLeave={() => setMonitorOpen(false)}
          >
            <div className="subagent-drawer-panel">
              <SubagentMonitor sessionId={sessionId} onClose={() => setMonitorOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
