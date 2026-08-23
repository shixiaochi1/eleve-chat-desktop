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
import { getDelegationStatus, setDelegationPause, interruptSubagent } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { Pause, Play, Square, Bot, ChevronDown } from 'lucide-react';
import SubagentMonitor, { useSubagentTasks } from './SubagentMonitor';
import StateDot from './StateDot';
// 🔴 2026-08-17 链路闭合修复：delegation.status 水合监控 store 用
// （事件流瞬时通道的恢复面；与 useMessageStream 同一 setMonitorState 源）
import { setMonitor } from '../store/debug';

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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 🔴 2026-08-15 监控面板开合：按钮在状态栏内，新任务到达自动展开
  const { tasks: monitorTasks, runningCount } = useSubagentTasks(sessionId);
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
      // 🔴 2026-08-17 链路闭合修复（E-F3 补全：事件流是瞬时通道，父轮结束/
      // 页面刷新后运行中的后台子不再有事件到达——delegation.status 轮询
      // 是唯一恢复面）。把 active[]（registry 键 = 子会话 id）水合进监控
      // store：与 useMessageStream 的 childSessionId 键同一键空间，卡片
      // 刷新后可恢复、steer/kill 恒命中 registry 键（E-F2 双卡片消解）。
      // 只补 running 缺口，不覆盖事件已写入的终态/富字段（spread 保留）。
      const active = res.active ?? [];
      if (active.length > 0) {
        setMonitor((prev) => {
          const tasks = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
          for (const sa of active) {
            if (!sa.subagent_id) continue;
            const existing = (tasks[sa.subagent_id] as Record<string, unknown> | undefined) || {};
            tasks[sa.subagent_id] = {
              ...existing,
              id: sa.subagent_id,
              childSessionId: sa.subagent_id,
              sessionId,
              goal: existing.goal ?? sa.goal,
              model: existing.model ?? sa.model,
              depth: existing.depth ?? sa.depth,
              // 状态以事件为准；水合仅在无事件时兜底为 running
              status: existing.status ?? 'running',
              eventType: existing.eventType ?? 'subagent.start',
            };
          }
          return { ...prev, delegateTasks: tasks };
        });
      }
    } catch {
      // 静默
    }
  }, [sessionId]);

  // 会话存在期间持续轮询委托状态（🔴 2026-08-17 链路闭合修复：不再限于
  // isStreaming——后台子通常在父轮结束后仍在运行，轮询必须跨轮持续，
  // 状态栏/监控面板才能反映真实运行态并可恢复；streaming 时 3s 节奏不变）
  useEffect(() => {
    if (!sessionId) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    poll();
    timerRef.current = setInterval(poll, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionId, poll]);

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

  // 🔴 2026-08-18 老大反馈修复：逐分支 kill 由监控抽屉承担（TaskCard 头部
  // X 按钮，同 registry 键寻址）——状态栏不再放逐条 chips，右端保持单一簇。

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
        {/* 🔴 2026-08-23：执行任务中（Agent/子 Agent 运行）加尾随跳动点动画，
            与消息区思考中的波浪点同款（agent-status-dot）；就绪/暂停不显示 */}
        {((hasSubagents && !paused) || isStreaming) && (
          <span aria-hidden className="flex shrink-0 items-end gap-[2px] text-muted-foreground/60">
            <span className="agent-status-dot" />
            <span className="agent-status-dot" style={{ animationDelay: '0.15s' }} />
            <span className="agent-status-dot" style={{ animationDelay: '0.3s' }} />
          </span>
        )}

        {/* 🔴 2026-08-18 老大反馈修复：右端单一控制簇——ml-auto 只出现一次，
            杜绝原先「监控按钮 + chips 区」双 ml-auto 把按钮挤到中间错位；
            子 Agent 逐条 chips（current_tool / 12 字截断 goal / 原始 id 混排 +
            内嵌横向滚动条 = 乱七八糟观感）移出状态栏——逐分支详情/中断由
            监控抽屉承担（新任务到达自动展开，不丢能力）。 */}
        <div className="ml-auto flex items-center gap-1.5">
          {showControls && (
            <>
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
            </>
          )}
          {/* 🔴 2026-08-15 子 Agent 监控触发按钮（对齐 DSH SubagentCatalogAction trigger：
              StateDot 像素追逐动画点 + 计数 + chevron；点击弹出顶部抽屉）。
              老大调整：文案"子Agent（个数）"。 */}
          {hasMonitorTasks && (
            <button
              type="button"
              className={cn(
                'flex items-center gap-[3px] min-h-[28px] px-1 rounded-md bg-transparent text-[12px] leading-[18px] cursor-pointer transition-colors',
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
        </div>
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
