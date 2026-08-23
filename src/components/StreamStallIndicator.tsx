import { useEffect, useState } from 'react';
import ActivityTimerText from './ActivityTimerText';
import { useElapsedSeconds } from '@/hooks/useActivityTimer';

/**
 * StreamStallIndicator — 流式停滞提示（对齐 Hermes StreamStallIndicator）
 *
 * 流式消息在 STREAM_STALL_S 秒内文本无进展时，显示"正在思考 + 已等待秒数"，
 * 让用户区分"模型还在工作"与"卡死了"（网络中断/后端挂起）。
 *
 * 机制（与 Hermes 一致）：
 * - 监听文本长度：每次增长 = 有进展 → 重置计时器
 * - 超时未增长 → stalled=true → 显示提示 + 计时器从超时那一刻开始计秒
 * - 文本恢复增长 → 提示消失（计时器重置）
 */
const STREAM_STALL_S = 12;

interface StreamStallIndicatorProps {
  /** 当前流式消息的完整文本（长度变化 = 进展信号） */
  text: string;
}

export default function StreamStallIndicator({ text }: StreamStallIndicatorProps) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    setStalled(false);
    const id = window.setTimeout(() => setStalled(true), STREAM_STALL_S * 1000);
    return () => window.clearTimeout(id);
  }, [text.length]);

  const elapsed = useElapsedSeconds(stalled, 'stall:current');

  if (!stalled) return null;

  return (
    <div
      className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/70"
      role="status"
      aria-live="polite"
    >
      <span>Eleve 正在思考</span>
      {/* 🔴 2026-08-23：静态方块点 → 宫格同款尾随跳动点（agent-status-dot），
          与思考动画统一，不再出现"静态点 + 动态点"重复 */}
      <span aria-hidden className="flex shrink-0 items-end gap-[2px]">
        <span className="agent-status-dot" />
        <span className="agent-status-dot" style={{ animationDelay: '0.15s' }} />
        <span className="agent-status-dot" style={{ animationDelay: '0.3s' }} />
      </span>
      <ActivityTimerText seconds={elapsed} />
    </div>
  );
}
