/**
 * AgentChatCard — 宫格 per-Agent 全功能聊天卡片
 *
 * 北极星（老大 2026-07-30）：宫格里每个 Agent 和单视图一样的全功能，不是监视面板。
 * 本卡片 = 标题栏(拖拽手柄+状态灯+展开) + 消息区(窗口化+上翻加载) + 流式气泡 +
 * per-agent 输入框 + 交互弹窗(approval/clarify/sudo/secret)。
 *
 * 架构原则：
 * - 纯受控：所有数据/动作经 props（state + 回调），本卡片不持有 WS/store 耦合
 * - 交互弹窗复用单视图同款组件（ApprovalCard/ClarifyCard/CredentialCard）——它们自行
 *   发送回传 RPC（按 session_id/request_id 天然路由到正确 profile），是单一权威路径
 * - 流式气泡独立于消息列表渲染（streamText 高频更新不重渲染历史消息）
 * - 上翻加载 prepend 时保持视口位置（记录 scrollHeight 差值补偿）
 * - memo 化：父级按 profile patch 状态，未变 profile 的卡片 props 引用不变 → 跳过重渲染
 */
import { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bot, Cpu, GripVertical, Maximize2, Square, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import MessageRow from './MessageRow';
import ApprovalCard from './ApprovalCard';
import ClarifyCard from './ClarifyCard';
import CredentialCard from './CredentialCard';
import type { AgentChatState } from '../hooks/useGridChat';

export interface AgentProfileInfo {
  name: string;
  display_name?: string | null;
  model: string | null;
  provider: string | null;
}

export interface AgentCardColor {
  dot: string;
  ring: string;
  bg: string;
}

interface AgentChatCardProps {
  profile: AgentProfileInfo;
  state: AgentChatState;
  color: AgentCardColor;
  focused: boolean;
  onSend: (profile: string, text: string) => void;
  onLoadMore: (profile: string) => void;
  onAbort: (profile: string) => void;
  onClearPending: (profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret') => void;
  onExpand: (profile: string) => void;
}

// ── pending 交互 payload 形状（与单视图 activeApproval/activeClarify/activeSudo 一致）──
interface ApprovalPayload { command?: string; description?: string; pattern?: string; choices?: string[]; run_id?: string }
interface ClarifyPayload { clarify_id?: string; question?: string; choices?: string[] }
interface SudoPayload { request_id?: string; prompt?: string }
interface SecretPayload { request_id?: string; prompt?: string; env_var?: string }

// ── 状态灯：绿=idle / 蓝闪=streaming / 橙闪=waiting ──
function StatusDot({ status }: { status: AgentChatState['status'] }) {
  const cfg = status === 'streaming'
    ? { color: 'var(--ui-blue)', pulse: true, title: '运行中' }
    : status === 'waiting'
      ? { color: 'var(--ui-orange)', pulse: true, title: '等待输入' }
      : { color: 'var(--ui-green)', pulse: false, title: '空闲' };
  return (
    <span
      className={cn('w-2 h-2 rounded-full shrink-0', cfg.pulse && 'animate-pulse')}
      style={{ background: cfg.color }}
      title={cfg.title}
    />
  );
}

export const AgentChatCard = memo(function AgentChatCard({
  profile, state, color, focused,
  onSend, onLoadMore, onAbort, onClearPending, onExpand,
}: AgentChatCardProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevTopIdRef = useRef<string | null>(null);

  const name = profile.name;

  // ── 滚动：到顶触发上翻 + 跟踪是否贴底 ──
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 40 && state.hasMore && !state.isLoadingMore) {
      onLoadMore(name);
    }
    stickBottomRef.current = el.scrollHeight - (el.scrollTop + el.clientHeight) < 60;
  }, [state.hasMore, state.isLoadingMore, onLoadMore, name]);

  // ── 上翻加载 prepend 后保持视口位置（scrollHeight 差值补偿） ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const topId = state.messages[0]?.id ?? null;
    if (prevTopIdRef.current && topId && topId !== prevTopIdRef.current && prevScrollHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    }
    prevTopIdRef.current = topId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [state.messages]);

  // ── 贴底时跟随新内容（新消息 / 流式增长） ──
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.streamText, state.streamReasoning]);

  // ── 发送 ──
  const handleSend = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    onSend(name, t);
    setDraft('');
    stickBottomRef.current = true;
  }, [draft, onSend, name]);

  const approval = state.pendingApproval as ApprovalPayload | null;
  const clarify = state.pendingClarify as ClarifyPayload | null;
  const sudo = state.pendingSudo as SudoPayload | null;
  const secret = state.pendingSecret as SecretPayload | null;
  const streaming = state.status === 'streaming';

  return (
    <div
      className={cn(
        'w-full h-full flex flex-col rounded-xl border overflow-hidden min-h-0 transition-shadow duration-200',
        focused ? 'border-transparent shadow-lg' : 'border-border/60 opacity-90 hover:opacity-100'
      )}
      style={{
        background: 'var(--ui-card-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: focused ? `0 0 0 2px ${color.ring}, 0 8px 24px rgba(0,0,0,0.3)` : undefined,
      }}
    >
      {/* ── 标题栏（整条可拖拽换位 · data-drag-handle · 展开按钮经 closest('button') 排除） ── */}
      <div
        data-drag-handle
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border/40 select-none cursor-grab active:cursor-grabbing touch-none"
        style={{ background: color.bg }}
      >
        <div className="flex items-center justify-center -ml-1.5 px-0.5 py-1 rounded hover:bg-accent/40 transition-colors shrink-0">
          <GripVertical size={13} strokeWidth={1.5} className="text-muted-foreground/40" />
        </div>
        <div
          className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ background: `${color.dot}22`, color: color.dot }}
        >
          <Bot size={13} strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {profile.display_name || profile.name}
        </span>
        {profile.model && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 shrink-0 max-w-[100px]">
            <Cpu size={9} strokeWidth={1.5} />
            <span className="truncate">{profile.model}</span>
          </span>
        )}
        <StatusDot status={state.status} />
        <button
          className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 cursor-pointer"
          title="展开为单视图"
          onClick={() => onExpand(name)}
        >
          <Maximize2 size={12} strokeWidth={1.5} />
        </button>
      </div>

      {/* ── 消息区 ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 py-2 overscroll-contain"
        onScroll={handleScroll}
      >
        {/* 上翻加载指示 */}
        {state.hasMore && (
          <div className="flex justify-center py-1.5">
            {state.isLoadingMore ? (
              <Loader2 size={13} className="animate-spin text-muted-foreground/40" />
            ) : (
              <button
                className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                onClick={() => onLoadMore(name)}
              >
                ↑ 加载更早消息
              </button>
            )}
          </div>
        )}

        {state.messages.length === 0 && !state.streamText ? (
          <div className="flex flex-col items-center justify-center gap-1.5 h-full py-8">
            <Bot size={22} strokeWidth={1} className="text-muted-foreground/20" />
            <span className="text-[10px] text-muted-foreground/30">暂无对话 · 下方输入开始</span>
          </div>
        ) : (
          state.messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}

        {/* ── 流式气泡（独立渲染，不重渲染历史列表） ── */}
        {(state.streamReasoning || state.streamText) && (
          <div className="flex flex-col gap-2 px-4 mb-1.5">
            {state.streamReasoning && (
              <div className="text-[11px] italic text-muted-foreground/70 whitespace-pre-wrap break-words border-l-2 border-border/40 pl-2">
                {state.streamReasoning}
              </div>
            )}
            {state.streamText && (
              <div className="w-fit max-w-[85%] min-w-0 bg-card text-card-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed border border-border shadow-sm overflow-hidden">
                <span className="whitespace-pre-wrap break-words">{state.streamText}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 交互弹窗（per-agent，复用单视图组件） ── */}
      {approval && (
        <div className="px-2.5 pb-1.5 shrink-0">
          <ApprovalCard
            command={approval.command}
            description={approval.description}
            pattern={approval.pattern}
            choices={approval.choices}
            run_id={approval.run_id}
            onDone={() => onClearPending(name, 'approval')}
          />
        </div>
      )}
      {clarify && (
        <div className="px-2.5 pb-1.5 shrink-0">
          <ClarifyCard
            clarifyId={clarify.clarify_id}
            question={clarify.question}
            choices={clarify.choices}
            onDone={() => onClearPending(name, 'clarify')}
          />
        </div>
      )}
      {sudo && (
        <div className="px-2.5 pb-1.5 shrink-0">
          <CredentialCard
            type="sudo"
            title="Sudo 权限请求"
            description={sudo.prompt || '需要 sudo 密码'}
            onSubmit={async (password) => {
              await call('sudo_respond', { request_id: sudo.request_id, password });
              onClearPending(name, 'sudo');
            }}
            onDismiss={() => onClearPending(name, 'sudo')}
          />
        </div>
      )}
      {secret && (
        <div className="px-2.5 pb-1.5 shrink-0">
          <CredentialCard
            type="secret"
            title="Secret 请求"
            description={`环境变量 ${secret.env_var ?? ''}: ${secret.prompt ?? '需要凭据'}`}
            onSubmit={async (value) => {
              await call('secret_respond', { request_id: secret.request_id, value });
              onClearPending(name, 'secret');
            }}
            onDismiss={() => onClearPending(name, 'secret')}
          />
        </div>
      )}

      {/* ── 输入区 ── */}
      <div className="shrink-0 px-2.5 pb-2.5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/20 focus-within:border-border">
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/30"
            placeholder={`发消息给 ${profile.display_name || profile.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          {streaming ? (
            <button
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
              title="中止"
              onClick={() => onAbort(name)}
            >
              <Square size={9} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
                draft.trim() ? 'bg-primary text-primary-foreground hover:brightness-110' : 'bg-muted-foreground/10 text-muted-foreground/30'
              )}
              title="发送 (Enter)"
              onClick={handleSend}
              disabled={!draft.trim()}
            >
              <Send size={9} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default AgentChatCard;
