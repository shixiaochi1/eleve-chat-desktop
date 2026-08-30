/**
 * SessionStatusDot — 会话状态点（对齐 Hermes app/chat/session-status-dot.tsx）
 *
 * 单一 UI 原语：侧栏会话行（ProjectTreePanel SessionItem）与面板行
 * （SessionsPanel renderSession）共用，同一会话在两处状态永远一致。
 * 状态互斥解析走 lib/session-dot-state.ts 纯函数；数据走 store/session-status.ts。
 *
 * 视觉语义（对齐 Hermes DOT_VARIANTS，ELEVE tailwind 风格）：
 * - needs-input：琥珀色稳态点——有 clarify/approval/secret 等在等用户（"该你操作了"）
 * - working：accent 脉冲——LLM turn 运行中
 * - stalled：accent 弱脉冲——权威 running 但静默超 8min（网络中断/后端挂起）
 * - background：灰色脉冲——LLM 空闲但会话有后台进程在跑（对齐 Hermes 灰点语义）
 * - unread：绿色稳态点——后台会话完成且未打开
 * - idle：灰色小点——空闲
 */
import { cn } from '../lib/utils';
import { useSessionStatus } from '../store/session-status';
import { sessionDotState, type SessionDotState } from '../lib/session-dot-state';

const DOT_BASE = 'inline-block size-1.5 rounded-full';

const DOT_VARIANTS: Record<SessionDotState, { className: string; pulse?: boolean; title?: string }> = {
  'needs-input': {
    className: `${DOT_BASE} bg-warning`,
    title: '等待输入（审批/澄清/密码等）',
  },
  working: {
    className: `${DOT_BASE} bg-primary`,
    pulse: true,
    title: '正在运行',
  },
  stalled: {
    className: `${DOT_BASE} bg-primary opacity-70`,
    pulse: true,
    title: '运行中（长时间无输出）',
  },
  background: {
    className: `${DOT_BASE} bg-muted-foreground/80`,
    pulse: true,
    title: '有后台进程在运行',
  },
  unread: {
    className: `${DOT_BASE} bg-success`,
    title: '已完成，未读',
  },
  idle: {
    className: 'inline-block size-1 rounded-full bg-muted-foreground/60',
    title: '空闲',
  },
};

export interface SessionStatusDotProps {
  sessionId: string;
  /** 外层 wrapper 类名（hover 淡出等场景） */
  className?: string;
  /** 🔴 2026-08-12 圆点颜色覆盖（SessionItem 选中行变橙色） */
  dotClassName?: string;
}

export function SessionStatusDot({ sessionId, className, dotClassName }: SessionStatusDotProps) {
  const st = useSessionStatus(sessionId);
  const dotState = sessionDotState({
    hasBackground: st.background,
    isStalled: st.stalled,
    isUnread: st.unread,
    isWorking: st.running,
    needsInput: st.needsInput,
  });
  const variant = DOT_VARIANTS[dotState];

  return (
    <span
      className={cn('inline-flex shrink-0 items-center', className)}
      role="status"
      title={variant.title}
      aria-label={variant.title}
    >
      <span className={cn(variant.className, variant.pulse && 'animate-pulse', dotClassName)} aria-hidden="true" />
    </span>
  );
}
