/**
 * ToolStatusBar — 聊天区顶部状态栏（F2 T2.3）
 *
 * 展示委托（子 Agent）运行状态 + 暂停/恢复/中断控制。
 * 对齐 Hermes delegation.pause / delegation.status / subagent.interrupt。
 * 仅在 streaming 或有活跃子 Agent 时显示控制按钮。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getDelegationStatus, setDelegationPause, interruptSubagent } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { Pause, Play, Square, Bot } from 'lucide-react';

interface ToolStatusBarProps {
  sessionId?: string | null;
  isStreaming?: boolean;
}

export default function ToolStatusBar({ sessionId, isStreaming }: ToolStatusBarProps) {
  const [paused, setPaused] = useState(false);
  const [hasSubagents, setHasSubagents] = useState(false);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await getDelegationStatus(sessionId);
      setPaused(res.paused);
      setHasSubagents(res.has_subagents);
      setRunning(res.running);
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

  // 无活跃子 Agent 且非 streaming → 显示简洁标题
  const showControls = hasSubagents || (isStreaming && running);

  return (
    <div className="flex items-center h-10 px-4 border-b border-border gap-2">
      <Bot size={14} className={cn('shrink-0', hasSubagents ? 'text-primary' : 'text-muted-foreground/40')} />
      <span className="text-xs text-muted-foreground/60">
        {hasSubagents
          ? (paused ? '委托已暂停' : '子 Agent 运行中')
          : isStreaming
            ? 'Agent 运行中'
            : '就绪'}
      </span>

      {showControls && (
        <div className="flex items-center gap-1 ml-auto">
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
  );
}
