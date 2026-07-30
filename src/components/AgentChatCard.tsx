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
import { Bot, Maximize2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import MessageRow from './MessageRow';
import ApprovalCard from './ApprovalCard';
import ClarifyCard from './ClarifyCard';
import CredentialCard from './CredentialCard';
import AgentCardComposer from './AgentCardComposer';
import ModelPill from './ModelPill';
import { useImageAttachments } from '@/hooks/useImageAttachments';
import type { GroupedModels } from '@/hooks/useModels';
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
  onClearPending: (profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret') => void;
  onExpand: (profile: string) => void;
  /** 新建会话（清空本 Agent 上下文） */
  onNewSession: (profile: string) => void;
  /** per-agent slash 命令执行 */
  onCommand: (profile: string, cmdName: string, args: string) => void;
  /** 模型系统（全局单一数据源，经 App useModels 下发） */
  currentModel?: string;
  modelGrouped?: GroupedModels;
  modelLoading?: boolean;
  modelError?: string | null;
  onSelectModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
  onRefreshModels?: () => void;
}

// ── pending 交互 payload 形状（与单视图 activeApproval/activeClarify/activeSudo 一致）──
interface ApprovalPayload { command?: string; description?: string; pattern?: string; choices?: string[]; run_id?: string }
interface ClarifyPayload { clarify_id?: string; question?: string; choices?: string[] }
interface SudoPayload { request_id?: string; prompt?: string }
interface SecretPayload { request_id?: string; prompt?: string; env_var?: string }

// ── 机器人头像 — 三形态小机器人（空闲打盹 / 运行忙碌 / 等待睜大眼）──
// 身份 = 头壳轮廓与填色（Agent 身份色，恒定）；状态 = 眼睧/天线灯/信号波/嘴巴（状态色）
// 全部 SVG 部件动画（CSS keyframes 驱动，GPU 友好，零 JS 定时器）
function RobotAvatar({ status, agentColor }: { status: AgentChatState['status']; agentColor: string }) {
  const mode = status === 'streaming' ? 'streaming' : status === 'waiting' ? 'waiting' : 'idle';
  const accent = status === 'streaming' ? 'var(--ui-blue)' : status === 'waiting' ? 'var(--ui-orange)' : 'var(--ui-green)';
  const title = mode === 'streaming' ? '运行中' : mode === 'waiting' ? '等待输入' : '空闲';
  return (
    <div
      className={cn('robot-avatar flex items-center justify-center w-6 h-6 rounded-lg shrink-0', `robot-${mode}`)}
      style={{ background: `color-mix(in srgb, ${agentColor} 13%, transparent)` }}
      title={title}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <g className="r-body">
          <g className="r-head-group">
            {/* 信号波 — 仅运行时向外辐射（两道弧线交替扩散淡出） */}
            <path className="r-wave r-wave-1" d="M10.2 3.1 A2.6 2.6 0 0 1 13.8 3.1" stroke={accent} strokeWidth="1.1" strokeLinecap="round" />
            <path className="r-wave r-wave-2" d="M9.2 2.1 A4 4 0 0 1 14.8 2.1" stroke={accent} strokeWidth="1.1" strokeLinecap="round" />
            {/* 天线 — 杆是身份色，灯是状态色（运行快闪 / 等待急促 / 空闲慵懒） */}
            <line x1="12" y1="6.2" x2="12" y2="8.3" stroke={agentColor} strokeWidth="1.2" strokeLinecap="round" />
            <circle className="r-tip" cx="12" cy="4.9" r="1.25" fill={accent} />
            {/* 头壳 — 身份色轮廓与填色 */}
            <rect x="4.6" y="8.2" width="14.8" height="12" rx="3.2" fill={`color-mix(in srgb, ${agentColor} 24%, transparent)`} stroke={agentColor} strokeWidth="1.1" />
            {/* 耳朵 */}
            <rect x="2.3" y="11.8" width="2.3" height="4.6" rx="1.15" fill={agentColor} opacity="0.5" />
            <rect x="19.4" y="11.8" width="2.3" height="4.6" rx="1.15" fill={agentColor} opacity="0.5" />
            {/* 眼睛 — 巩膜 + 眼睧（眼睧色 = 状态色：空闲偶尔眨眼 / 运行滴溜溜扫描 / 等待睜大望向你） */}
            <g className="r-eye">
              <circle cx="9.2" cy="13.6" r="1.75" fill="var(--ui-card-bg)" />
              <circle className="r-pupil" cx="9.2" cy="13.6" r="0.85" fill={accent} />
            </g>
            <g className="r-eye">
              <circle cx="14.8" cy="13.6" r="1.75" fill="var(--ui-card-bg)" />
              <circle className="r-pupil" cx="14.8" cy="13.6" r="0.85" fill={accent} />
            </g>
            {/* 嘴巴 — 一字型（空闲）/ o 型（运行=边说边输出 / 等待=期待） */}
            <rect className="r-mouth-line" x="10.4" y="17" width="3.2" height="1.1" rx="0.55" fill={accent} opacity="0.65" />
            <circle className="r-mouth-o" cx="12" cy="17.55" r="0.95" fill={accent} />
          </g>
        </g>
      </svg>
    </div>
  );
}

export const AgentChatCard = memo(function AgentChatCard({
  profile, state, color, focused, portReady,
  onSend, onLoadMore, onAbort, onClearPending, onExpand, onNewSession, onCommand,
  currentModel, modelGrouped, modelLoading, modelError, onSelectModel, onOpenSettings, onRefreshModels,
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
    attachedImages, uploading: imageUploading, addImage, removeImage,
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
  }, [state.messages.length, state.streamText, state.streamReasoning]);

  // ── 发送（贴底跟随 + 路由到本 Agent）──
  const handleSend = useCallback((text: string) => {
    stickBottomRef.current = true;
    onSend(name, text);
  }, [onSend, name]);

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
      {/* ── 工具状态栏（整条可拖拽换位 · data-drag-handle · 按钮经 closest('button') 排除）──
          布局：[机器人头像(三形态)] [名称]  …  [模型选择] [展开] */}
      <div
        data-drag-handle
        className="flex items-center gap-2 h-11 px-3 shrink-0 border-b border-border/40 select-none cursor-grab active:cursor-grabbing touch-none"
        style={{ background: color.bg }}
      >
        {/* Agent 身份 — 三形态小机器人（空闲打盹 / 运行忙碌 / 等待睜大眼） */}
        <RobotAvatar status={state.status} agentColor={color.dot} />
        <span className="text-[13px] font-semibold tracking-tight text-foreground truncate min-w-0">
          {profile.display_name || profile.name}
        </span>

        {/* 右侧工具簇 — 模型选择 + 展开 */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <div className="-my-1">
            <ModelPill
              model={currentModel}
              grouped={modelGrouped}
              loading={modelLoading}
              error={modelError}
              onSelect={onSelectModel}
              onOpenSettings={onOpenSettings}
              onRefresh={onRefreshModels}
            />
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

        {state.messages.length === 0 && !state.streamText ? (
          <div className="flex flex-col items-center justify-center gap-1.5 h-full py-8">
            <Bot size={22} strokeWidth={1} className="text-muted-foreground/20" />
            <span className="text-[10px] text-muted-foreground/30">暂无对话 · 下方输入开始</span>
          </div>
        ) : (
          state.messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}

        {/* ── 流式气泡 — 经 MessageRow 渲染 = 与单视图 100% 一致（不重复造轮子）──
            单视图流式 = store 里 pending 消息经 MessageRow（MessageBubble streaming 模式 +
            ReasoningBlock shimmer/计时器/折叠）。宫格用合成 pending 消息走同一条渲染路径，
            气泡样式/推理块/间距全自动对齐，MessageRow 任何改动宫格流式同步生效。
            独立于 state.messages 渲染 → 30fps streamText 更新不重渲染历史列表（性能优化保留）。 */}
        {(state.streamReasoning || state.streamText) && (
          <MessageRow
            message={{
              id: `${name}-streaming`,
              role: 'assistant',
              pending: true,
              parts: [
                ...(state.streamReasoning ? [{ type: 'reasoning' as const, text: state.streamReasoning }] : []),
                ...(state.streamText ? [{ type: 'text' as const, text: state.streamText }] : []),
              ],
            }}
          />
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
