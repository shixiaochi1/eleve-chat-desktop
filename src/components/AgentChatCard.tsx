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
 * - 流式气泡独立于消息列表渲染（streamParts 30fps flush 不重渲染历史消息）
 * - 上翻加载 prepend 时保持视口位置（记录 scrollHeight 差值补偿）
 * - memo 化：父级按 profile patch 状态，未变 profile 的卡片 props 引用不变 → 跳过重渲染
 */
import { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bot, Maximize2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import MessageRow from './MessageRow';
import ApprovalCard from './ApprovalCard';
import ClarifyCard from './ClarifyCard';
import CredentialCard from './CredentialCard';
import AgentCardComposer from './AgentCardComposer';
import ModelPill from './ModelPill';
import SlashConfirmCard from './SlashConfirmCard';
import { useImageAttachments } from '@/hooks/useImageAttachments';
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
  portReady: boolean;
  onSend: (profile: string, text: string) => void;
  onLoadMore: (profile: string) => void;
  onAbort: (profile: string) => void;
  onClearPending: (profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret' | 'slash_confirm') => void;
  onExpand: (profile: string) => void;
  /** 新建会话（清空本 Agent 上下文） */
  onNewSession: (profile: string) => void;
  /** per-agent slash 命令执行 */
  onCommand: (profile: string, cmdName: string, args: string) => void;
  /** slash 破坏性命令确认完成（输出上屏 + session 轮换，对齐单视图） */
  onSlashConfirmDone: (profile: string, choice: string, result?: { output?: string; session_id?: string }) => void;
}

// ── pending 交互 payload 形状（与单视图 activeApproval/activeClarify/activeSudo 一致）──
interface ApprovalPayload { command?: string; description?: string; pattern?: string; choices?: string[]; run_id?: string }
interface ClarifyPayload { clarify_id?: string; question?: string; choices?: string[] }
interface SudoPayload { request_id?: string; prompt?: string }
interface SecretPayload { request_id?: string; prompt?: string; env_var?: string }

// ── 机器人头像 — 静态小机器人（纯身份展示，无状态/无动画，简单）──
// 头壳/耳朵/天线/眼睧/嘴巴全部 Agent 身份色，巩膜用卡片底色对比
function RobotAvatar({ agentColor }: { agentColor: string }) {
  return (
    <div
      className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0"
      style={{ background: `color-mix(in srgb, ${agentColor} 13%, transparent)` }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        {/* 天线 */}
        <line x1="12" y1="6.2" x2="12" y2="8.3" stroke={agentColor} strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="12" cy="4.9" r="1.25" fill={agentColor} />
        {/* 头壳 */}
        <rect x="4.6" y="8.2" width="14.8" height="12" rx="3.2" fill={`color-mix(in srgb, ${agentColor} 24%, transparent)`} stroke={agentColor} strokeWidth="1.1" />
        {/* 耳朵 */}
        <rect x="2.3" y="11.8" width="2.3" height="4.6" rx="1.15" fill={agentColor} opacity="0.5" />
        <rect x="19.4" y="11.8" width="2.3" height="4.6" rx="1.15" fill={agentColor} opacity="0.5" />
        {/* 眼睛 — 巩膜卡片底色，眼睧身份色 */}
        <circle cx="9.2" cy="13.6" r="1.75" fill="var(--ui-card-bg)" />
        <circle cx="9.2" cy="13.6" r="0.85" fill={agentColor} />
        <circle cx="14.8" cy="13.6" r="1.75" fill="var(--ui-card-bg)" />
        <circle cx="14.8" cy="13.6" r="0.85" fill={agentColor} />
        {/* 嘴巴 */}
        <rect x="10.4" y="17" width="3.2" height="1.1" rx="0.55" fill={agentColor} opacity="0.65" />
      </svg>
    </div>
  );
}

export const AgentChatCard = memo(function AgentChatCard({
  profile, state, color, focused, portReady,
  onSend, onLoadMore, onAbort, onClearPending, onExpand, onNewSession, onCommand, onSlashConfirmDone,
}: AgentChatCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevTopIdRef = useRef<string | null>(null);

  const name = profile.name;

  // per-agent 图片附件 — 绑到本 Agent 的 session（getSessionId 随状态槽实时取值）
  const stateRef = useRef(state);
  stateRef.current = state;
  const {
    attachedImages, uploading: imageUploading, addImage, removeImage, clearImages,
  } = useImageAttachments({ getSessionId: () => stateRef.current.sessionId });

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
  }, [state.messages.length, state.streamParts]);

  // ── 发送（贴底跟随 + 路由到本 Agent + 清图片预览）──
  const handleSend = useCallback((text: string) => {
    stickBottomRef.current = true;
    onSend(name, text);
    clearImages(); // 🔴 P1-8: 发送后清图片附件预览，对齐单视图
  }, [onSend, name, clearImages]);

  const approval = state.pendingApproval as ApprovalPayload | null;
  const clarify = state.pendingClarify as ClarifyPayload | null;
  const sudo = state.pendingSudo as SudoPayload | null;
  const secret = state.pendingSecret as SecretPayload | null;
  const slashConfirm = state.pendingSlashConfirm;
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
      {/* ── 工具状态栏（整条可拖拽换位 · data-drag-handle · 按钮经 closest('button') 排除）──
          布局：[机器人头像] [名称]  …  [模型选择] [展开] */}
      <div
        data-drag-handle
        className="flex items-center gap-2 h-11 px-3 shrink-0 border-b border-border/40 select-none cursor-grab active:cursor-grabbing touch-none"
        style={{ background: color.bg }}
      >
        {/* Agent 身份 — 静态小机器人（简单，不显示状态） */}
        <RobotAvatar agentColor={color.dot} />
        <span className="text-[13px] font-semibold tracking-tight text-foreground truncate min-w-0">
          {profile.display_name || profile.name}
        </span>

        {/* 右侧工具簇 — 模型选择 + 展开 */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <div className="-my-1">
            <ModelPill model={state.modelName ?? undefined} />
          </div>
          <button
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 cursor-pointer"
            title="展开为单视图"
            onClick={() => onExpand(name)}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
        </div>
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

        {state.messages.length === 0 && !state.streamParts?.length ? (
          <div className="flex flex-col items-center justify-center gap-1.5 h-full py-8">
            <Bot size={22} strokeWidth={1} className="text-muted-foreground/20" />
            <span className="text-[10px] text-muted-foreground/30">暂无对话 · 下方输入开始</span>
          </div>
        ) : (
          state.messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}

        {/* ── 流式气泡 — 经 MessageRow 渲染 = 与单视图 100% 一致（不重复造轮子）──
            单视图流式 = store 里 pending 消息经 MessageRow（MessageBubble streaming 模式 +
            ReasoningBlock shimmer/计时器/三态折叠）。宫格用合成 pending 消息走同一条渲染路径，
            气泡样式/推理块/间距全自动对齐，MessageRow 任何改动宫格流式同步生效。
            🔴 Phase 1: streamParts = 累加器到达序 segment 的 flush 镜像（与单视图 live parts 同构），
            直接作为合成消息的 parts — 不再三字段拼装（消灭 reasoning→tools→text 类型序跳变）。
            独立于 state.messages 渲染 → 30fps flush 不重渲染历史列表（性能优化保留）。 */}
        {state.streamParts?.length > 0 && (
          <MessageRow
            message={{
              id: `${name}-streaming`,
              role: 'assistant',
              pending: true,
              parts: state.streamParts,
            }}
          />
        )}

        {/* ── 活动提示（thinking / tool.progress / delegate.progress / goal）── */}
        {state.activityHint && streaming && (
          <div className="px-3 py-1 text-[10px] text-muted-foreground/50 italic truncate" title={state.activityHint}>
            {state.activityHint}
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
            profile={name}
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
            profile={name}
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
              await call('sudo_respond', { request_id: sudo.request_id, password, profile: name });
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
              await call('secret_respond', { request_id: secret.request_id, value, profile: name });
              onClearPending(name, 'secret');
            }}
            onDismiss={() => onClearPending(name, 'secret')}
          />
        </div>
      )}
      {/* 🔴 破坏性 slash 命令确认（对齐单视图 SlashConfirmCard） */}
      {slashConfirm && (
        <div className="px-2.5 pb-1.5 shrink-0">
          <SlashConfirmCard
            confirmId={slashConfirm.confirmId}
            command={slashConfirm.command}
            description={slashConfirm.description}
            sessionId={state.sessionId ?? undefined}
            profile={name}
            onDone={(choice, result) => onSlashConfirmDone(name, choice, result)}
          />
        </div>
      )}

      {/* ── 输入区 — 全功能紧凑 Composer（自动撑大 + slash 补全 + 新建/附件/语音/发送）── */}
      <AgentCardComposer
        profileName={profile.display_name || profile.name}
        isStreaming={streaming}
        portReady={portReady}
        onSend={handleSend}
        onCommand={(cmdName, args) => onCommand(name, cmdName, args)}
        onAbort={() => onAbort(name)}
        onNewSession={() => onNewSession(name)}
        attachedImages={attachedImages}
        imageUploading={imageUploading}
        onAddImage={addImage}
        onRemoveImage={removeImage}
      />
    </div>
  );
});

export default AgentChatCard;
