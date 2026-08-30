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
import { useVirtualizer } from '@tanstack/react-virtual';
import { Maximize2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModelContext } from '../contexts/ModelContext';
import { call } from '../utils/bridge';
import { getProfileAvatar } from '../utils/api';
import { AgentAvatarSvg } from '../lib/agent-avatars';
import { getWsClient } from '../services/ws-client';
import { loadConnection, isRemoteMode } from '../lib/connection';
import { getRememberedWorkspaceCwd } from '../lib/workspace-cwd';
import MessageRow from './MessageRow';
import ApprovalCard from './ApprovalCard';
import ClarifyCard from './ClarifyCard';
import ClarifyBatchCard, { BatchQuestionWire } from './ClarifyBatchCard';
import CredentialCard from './CredentialCard';
import AgentCardComposer from './AgentCardComposer';
import ModelPill from './ModelPill';
import CardContextGauge from './CardContextGauge';
import SlashConfirmCard from './SlashConfirmCard';
import QueuePanel from './QueuePanel';
import GoalBar from './GoalBar';
import TodoPanel from './TodoPanel';
import { useImageAttachments } from '@/hooks/useImageAttachments';
import { useFileAttachments } from '@/hooks/useFileAttachments';
import { collectDroppedPaths, dragHasPaths } from '@/lib/paths-dnd';

import { useBackendQueue, type QueueEntry } from '@/hooks/useBackendQueue';
import { applyQueueEditToBubbles, applyQueueRemoveToBubbles, type QueueBubbleSyncOp } from '@/lib/queue-bubble-sync';
import type { AgentChatState } from '../hooks/useGridChat';

// 消息虚拟化估算高度/过扫（宫格卡片窄小，估算低于单视图 MessageContainer 的 220）
const ESTIMATED_ITEM_HEIGHT = 160;
const OVERSCAN = 4;

export interface AgentProfileInfo {
  name: string;
  display_name?: string | null;
  /** Agent 主题色（#RRGGBB，来自后端 profile.yaml color，仅 UI） */
  color?: string | null;
  /** 是否有头像（有图显示图，无图显示机器人 glyph） */
  avatar?: boolean;
  /** 默认头像 key（预设头像库，随主题色渲染 SVG） */
  avatar_key?: string | null;
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
  onSend: (profile: string, text: string, attachmentDataURLs?: string[], sessionId?: string) => void;
  onLoadMore: (profile: string) => void;
  onAbort: (profile: string) => void;
  onClearPending: (profile: string, kind: 'approval' | 'clarify' | 'clarify_batch' | 'sudo' | 'secret' | 'slash_confirm', sessionId?: string) => void;
  /** 🔴 2026-08-17 阶段4：后台会话交互横幅 → 切到该会话响应 */
  onSwitchSession?: (sessionId: string) => void;
  onExpand: (profile: string) => void;
  /** 新建会话（清空本 Agent 上下文） */
  onNewSession: (profile: string) => void;
  /** per-agent slash 命令执行 */
  onCommand: (profile: string, cmdName: string, args: string) => void;
  /** slash 破坏性命令确认完成（输出上屏 + session 轮换，对齐单视图） */
  onSlashConfirmDone: (profile: string, choice: string, result?: { output?: string; session_id?: string }) => void;
  /** 🔴 M-2 修复：选模型 → 写该卡片 profile 的 config + 切该卡片的 session（per-Agent 模型隔离） */
  onSelectModel?: (profile: string, modelId: string, sessionId?: string | null) => void;
  /** 🔴 2026-08-16（四系统联动审计 C2）：排队条目编辑/删除 → 乐观气泡同步
   *  （宫格 per-profile 消息列表 patch；单视图走 store/messages 全局） */
  onQueueBubbleSync?: (op: QueueBubbleSyncOp) => void;
  /** 🔴 2026-08-16（四系统联动审计 C3）：新会话 cwd 单一漏斗（对齐单视图
   *  usePromptActions getNewSessionCwd）——宫格图片附件懒创建会话时继承项目
   *  scope（原仅 remote 记忆，本地模式落后端 resolve 链） */
  getNewSessionCwd?: () => string | null;
}

// ── pending 交互 payload 形状（与单视图 activeApproval/activeClarify/activeSudo 一致）──
interface ApprovalPayload { command?: string; description?: string; pattern?: string; choices?: string[]; run_id?: string }
interface ClarifyPayload { clarify_id?: string; question?: string; choices?: string[]; multi_select?: boolean }
// 🔴 批量澄清 payload（对齐 Hermes questions batch：一次表单多题）
interface ClarifyBatchPayload { clarify_id?: string; title?: string | null; questions?: BatchQuestionWire[] }
interface SudoPayload { request_id?: string; prompt?: string }
interface SecretPayload { request_id?: string; prompt?: string; env_var?: string }

// ── 机器人头像 — 静态小机器人（纯身份展示，无状态/无动画，简单）──
// 有头像（avatar=true）时懒加载显示图片，无头像时显示主题色机器人 SVG
function RobotAvatar({ agentColor, profile }: { agentColor: string; profile?: AgentProfileInfo }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!profile?.avatar || profile?.avatar_key) { setSrc(null); return; }
    let cancelled = false;
    getProfileAvatar(profile.name)
      .then((res) => { if (!cancelled && res?.exists && res.data) setSrc(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [profile?.avatar, profile?.avatar_key, profile?.name]);

  // 默认头像 key → 主题色 SVG
  if (profile?.avatar_key) {
    return (
      <div className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0 overflow-hidden">
        <span className="block w-full h-full p-1" style={{ color: agentColor }}>
          <AgentAvatarSvg avatarKey={profile.avatar_key} color={agentColor} />
        </span>
      </div>
    );
  }
  if (src) {
    return (
      <div className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0 overflow-hidden">
        <img src={src} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
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
  onSend, onLoadMore, onAbort, onClearPending, onExpand, onNewSession, onCommand, onSlashConfirmDone, onSwitchSession,
  onSelectModel, onQueueBubbleSync, getNewSessionCwd,
}: AgentChatCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevTopIdRef = useRef<string | null>(null);
  /** 官格 composer 命令式句柄（队列编辑时读/写草稿） */
  const composerRef = useRef<{ getValue: () => string; setValue: (text: string) => void } | null>(null);

  const name = profile.name;

  // 🔴 宫格欢迎态对齐单视图：模型是否已配置（ModelContext 全局下发，无 prop drilling）
  const { grouped } = useModelContext();
  const hasModels = !!grouped && Object.values(grouped).some((g) => g.models.length > 0);

  // ── 排队编辑（对齐 Hermes use-composer-queue：per-agent queueEdit 状态）
  // 🔴 2026-08-16 方案A：队列数据源 = 后端权威投影（queue.status 轮询）
  const { queue: queueEntries, subagentActive, edit: queueEditEntry, remove: queueRemove, steer: queueSteer } = useBackendQueue(state.sessionId ?? null);
  const [queueEdit, setQueueEdit] = useState<{ entryIndex: number; draft: string } | null>(null);
  // 🔴 2026-08-15 DSH QueueDock 对齐（宫格）：排队面板改弹层开合（同单视图 InputArea）
  const [queueOpen, setQueueOpen] = useState(false);
  const queuePopupRef = useRef<HTMLDivElement | null>(null);
  const prevQueueCountRef = useRef(queueEntries.length);
  useEffect(() => {
    // 新条目入队 → 自动展开；清空 → 自动收起
    if (queueEntries.length > 0 && prevQueueCountRef.current === 0) setQueueOpen(true);
    if (queueEntries.length === 0) setQueueOpen(false);
    prevQueueCountRef.current = queueEntries.length;
  }, [queueEntries.length]);
  useEffect(() => {
    // 进入编辑态强制展开
    if (queueEdit) setQueueOpen(true);
  }, [queueEdit]);
  // 点击弹层外关闭（编辑中不自动收起；排除开合按钮——toggle 负责开关，
  // 否则 mousedown 先关、click 再开，按钮关不掉面板）
  useEffect(() => {
    if (!queueOpen || queueEdit) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-queue-toggle]')) return;
      if (queuePopupRef.current && !queuePopupRef.current.contains(t)) setQueueOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [queueOpen, queueEdit]);

  const beginQueueEdit = useCallback((entry: QueueEntry, currentDraft: string) => {
    if (queueEdit) return;
    setQueueEdit({ entryIndex: entry.index, draft: currentDraft });
    // 加载条目文本到 composer（对齐 Hermes loadIntoComposer）
    composerRef.current?.setValue(entry.text);
  }, [queueEdit]);

  const stepQueueEdit = useCallback((direction: -1 | 1, currentDraft: string): { text: string; done: boolean } | null => {
    if (!queueEdit) return null;
    const index = queueEntries.findIndex((e) => e.index === queueEdit.entryIndex);
    const target = index + direction;
    if (index < 0 || target < 0) return index >= 0 ? { text: currentDraft, done: false } : null;
    // 保存当前编辑（后端 queue.edit RPC，轮询自动刷新）
    // 🔴 2026-08-16（审计 C2）：编辑成功后同步乐观气泡文本（busy 直发时前端
    //   乐观上屏的气泡仍显示旧文本）；expected_text CAS 防快照漂移
    const save = async () => {
      const current = currentDraft;
      if (!current.trim()) return;
      const entry = queueEntries.find((e) => e.index === queueEdit.entryIndex);
      const oldText = entry?.text ?? '';
      const ok = await queueEditEntry(queueEdit.entryIndex, current, oldText);
      if (ok && entry) {
        onQueueBubbleSync?.({ type: 'edit', oldText, newText: current, mediaCount: entry.media_count });
      }
    };
    void save();
    const next = queueEntries[target];
    if (next) {
      setQueueEdit({ ...queueEdit, entryIndex: next.index });
      return { text: next.text, done: false };
    }
    // 越过末条：退出编辑，恢复原草稿
    setQueueEdit(null);
    return { text: queueEdit.draft, done: true };
  }, [queueEdit, queueEntries, queueEditEntry, onQueueBubbleSync]);

  const exitQueueEdit = useCallback((action: 'save' | 'cancel', currentDraft: string): string | null => {
    if (!queueEdit) return null;
    if (action === 'save' && currentDraft.trim()) {
      // 🔴 2026-08-16（审计 C2）：同 stepQueueEdit——编辑成功同步乐观气泡
      const entry = queueEntries.find((e) => e.index === queueEdit.entryIndex);
      const oldText = entry?.text ?? '';
      void (async () => {
        const ok = await queueEditEntry(queueEdit.entryIndex, currentDraft, oldText);
        if (ok && entry) {
          onQueueBubbleSync?.({ type: 'edit', oldText, newText: currentDraft, mediaCount: entry.media_count });
        }
      })();
    }
    const restored = queueEdit.draft;
    setQueueEdit(null);
    return restored;
  }, [queueEdit, queueEntries, queueEditEntry, onQueueBubbleSync]);

  // per-agent 图片附件 — 绑到本 Agent 的 session（getSessionId 随状态槽实时取值）
  const stateRef = useRef(state);
  stateRef.current = state;
  const {
    attachedImages, uploading: imageUploading, addImage, addImageFromPath, removeImage, clearImages, uploadUnuploaded,
  } = useImageAttachments({ getSessionId: () => stateRef.current.sessionId });

  // 🔴 2026-08-09 文件附件（文件树拖入消息区 → 附件条 pill，对齐 Hermes 附件语义）
  const {
    attachedFiles,
    attaching: fileAttaching,
    error: fileError,
    attachPaths,
    removeFile: removeFileAttachment,
    clearFiles: clearFileAttachments,
    clearError: clearFileError,
  } = useFileAttachments({ getSessionId: () => stateRef.current.sessionId });

  // ── 消息虚拟化（对齐单视图 MessageContainer natural-flow 模式）──
  // 上翻加载按钮/空态/流式气泡在虚拟列表外渲染；padding spacers 撑起滚动高度
  // → prepend 补偿（scrollHeight 差值）与贴底跟随（scrollTop=scrollHeight）天然保持正确
  const virtualizer = useVirtualizer({
    count: state.messages.length,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getItemKey: (index) => state.messages[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = Math.max(0, totalSize - (virtualItems.at(-1)?.end ?? 0));

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

  // ── 发送（贴底跟随 + 路由到本 Agent + 🔴 附件归属处理）──
  const handleSend = useCallback(async (text: string) => {
    stickBottomRef.current = true;
    const wasBusy = state.status === 'streaming';
    const images = [...attachedImages];

    // 🔴 新会话图片附件 submit 时序（对齐 Hermes submit.ts，与主视图 App.handleSend 同构）：
    // 无会话时 addImage 仅本地暂存（uploaded=false）；发送前懒创建会话并上传，经 explicitSessionId 穿透到 sendTo。
    // 🔴 2026-08-22 修复：移除 !wasBusy——对齐 Hermes syncAttachmentsForSubmit【无条件】执行：
    // busy（排队）时也先 sync 附件，否则图片不进 session → Queue 快照空 → LLM 收不到图。
    let explicitSid: string | undefined;
    if (images.some((img) => !img.uploaded)) {
      const ws = getWsClient();
      let sid = stateRef.current.sessionId ?? undefined;
      if (!sid) {
        try {
          // 🔴 2026-08-16（四系统联动审计 C3）：新会话 cwd 单一漏斗——项目 scope
          //   （getNewSessionCwd，对齐单视图 usePromptActions）优先；remote 模式下
          //   未显式指定目录的新会话落上次工作目录（Hermes workspaceCwdForNewSession
          //   语义）；local 由后端 resolve 决定（原实现仅 remote 记忆 → 宫格图片
          //   附件懒创建会话不继承项目 scope）
          let cwd: string | undefined;
          const scopeCwd = getNewSessionCwd?.()?.trim();
          if (scopeCwd) {
            cwd = scopeCwd;
          } else {
            const conn = loadConnection();
            if (isRemoteMode(conn) && conn.baseUrl) {
              cwd = getRememberedWorkspaceCwd({ baseUrl: conn.baseUrl, profile: name }) || undefined;
            }
          }
          const created = await ws.sessionCreate({ profile: name, ...(cwd ? { cwd } : {}) });
          sid = created.session_id;
        } catch (err) {
          console.error('[AgentChatCard] sessionCreate failed, aborting send:', err);
          return; // 对齐 Hermes: 建会话失败 → 中止发送
        }
      }
      const synced = await uploadUnuploaded(sid);
      // 🔴 2026-08-27 修复：synced 是对象恒 truthy——原判断永不命中，上传
      // 失败也继续提交（对齐 App 版 !synced.ok 中止语义）
      if (!synced.ok) return; // 对齐 Hermes: 附件同步失败 → 中止发送
      explicitSid = sid;
    }

    // 准备附件 data URL（乐观上屏缩略图用；附件本体已由 uploadUnuploaded 附着后端 session）
    const dataURLs = images.map((img) => img.preview);

    // 🔴 2026-08-09 文件附件 ref_text 注入（对齐 Hermes attachment.refText 语义）
    const fileRefs = attachedFiles.map((f) => f.refText).join(' ');
    const finalText = fileRefs ? `${fileRefs}\n${text}` : text;

    onSend(name, finalText, dataURLs.length > 0 ? dataURLs : undefined, explicitSid);
    // 🔴 2026-08-16 方案A：附件归属后端权威——busy 直发后端 route_busy_submit：
    // media 非空必 fall through Queue，Queue 快照接管 attached_images 后
    // 后端自行 detach_image（dispatch.rs），Overflow 时保留 for retry；
    // 前端不再做条目级 imageDetach（旧前端自治队列配套，已退役）。
    if (images.length > 0) clearImages();
    if (attachedFiles.length > 0) clearFileAttachments();
  }, [onSend, name, clearImages, attachedImages, state.status, uploadUnuploaded, attachedFiles, clearFileAttachments, getNewSessionCwd]);

  // 🔴 2026-08-17 阶段4：交互按会话多槽——slot 会话交互渲染卡片，
  // 其他会话交互渲染横幅（点击切卡响应；不被 slot 守卫丢弃）。
  const slotSid = state.sessionId ?? '';
  const slotInteraction = slotSid ? state.interactions[slotSid] : undefined;
  const approval = slotInteraction?.kind === 'approval' ? (slotInteraction.data as unknown as ApprovalPayload) : null;
  const clarify = slotInteraction?.kind === 'clarify' ? (slotInteraction.data as unknown as ClarifyPayload) : null;
  const clarifyBatch = slotInteraction?.kind === 'clarify_batch' ? (slotInteraction.data as unknown as ClarifyBatchPayload) : null;
  const sudo = slotInteraction?.kind === 'sudo' ? (slotInteraction.data as unknown as SudoPayload) : null;
  const secret = slotInteraction?.kind === 'secret' ? (slotInteraction.data as unknown as SecretPayload) : null;
  const backgroundInteractions = Object.entries(state.interactions).filter(([sid]) => sid !== slotSid);
  const slashConfirm = state.pendingSlashConfirm;
  const streaming = state.status === 'streaming';

  return (
    <div
      className={cn(
        'w-full h-full flex flex-col rounded-xl border overflow-hidden min-h-0 transition-shadow duration-200',
        focused ? 'border-transparent shadow-lg' : 'border-[var(--ui-stroke-tertiary)] opacity-90 hover:opacity-100 shadow-sm'
      )}
      style={{
        background: 'var(--ui-card-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: focused ? `0 0 0 2px ${color.ring}, 0 8px 24px var(--theme-shadow-color-heavy)` : undefined,
      }}
    >
      {/* ── 工具状态栏（整条可拖拽换位 · data-drag-handle · 按钮经 closest('button') 排除）──
          布局：[机器人头像] [名称]  …  [模型选择] [展开]
          🔴 2026-08-02 老大需求：双击工具状态栏任意处 → 展开为单视图（与右侧展开按钮同一出口 onExpand）*/}
      <div
        data-drag-handle
        className="flex items-center gap-2 h-11 px-3 shrink-0 border-b border-[var(--ui-stroke-quaternary)] select-none cursor-grab active:cursor-grabbing touch-none"
        style={{ background: color.bg }}
        onDoubleClick={() => onExpand(name)}
        title="双击展开为单视图"
      >
        {/* Agent 身份 — 有头像显示头像，无头像显示机器人 */}
        <RobotAvatar agentColor={color.dot} profile={profile} />
        <span className="text-[13px] font-semibold tracking-tight text-foreground truncate min-w-0">
          {profile.display_name || profile.name}
        </span>

        {/* 右侧工具簇 — 模型选择 + 上下文环 + 展开 */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <div className="-my-1">
            <ModelPill
              model={state.modelName ?? undefined}
              onSelect={(modelId) => onSelectModel?.(profile.name, modelId, state.sessionId)}
            />
          </div>
          <CardContextGauge sessionId={state.sessionId ?? null} active={focused} />
          <button
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 cursor-pointer"
            title="展开为单视图"
            onClick={() => onExpand(name)}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ── 消息区（🔴 2026-08-08 图片拖入消息区 → 附件预览，对齐 Hermes useFileDropZone）── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 py-2 overscroll-contain"
        onScroll={handleScroll}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          // 🔴 2026-08-09 文件树路径拖入 → 附件条（图片走缩略图，文件走 pill）
          if (dragHasPaths(e.dataTransfer)) {
            const paths = collectDroppedPaths(e.dataTransfer);
            if (paths.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              const imagePaths: string[] = [];
              const filePaths: string[] = [];
              for (const p of paths) {
                if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(p)) imagePaths.push(p);
                else filePaths.push(p);
              }
              if (imagePaths.length > 0) {
                for (const p of imagePaths) void addImageFromPath(p);
              }
              if (filePaths.length > 0) void attachPaths(filePaths);
            }
            return;
          }
          const files = Array.from(e.dataTransfer.files);
          const imageFiles = files.filter((f) => f.type.startsWith('image/'));
          if (imageFiles.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          for (const file of imageFiles) {
            void addImage(file);
          }
        }}
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
          <div className="flex flex-col items-center justify-center gap-1.5 h-full px-4 py-4 text-center">
            <div className="w-11 h-11 opacity-90">
              <img src="/Elogo.svg" alt="Eleve" className="w-full h-full object-contain" />
            </div>
            <span className="text-[11px] font-semibold text-foreground/80">Eleve Agent</span>
            {!portReady ? (
              <span className="text-[10px] font-medium text-destructive">网关未连接</span>
            ) : !hasModels ? (
              <span className="text-[10px] text-muted-foreground">尚未配置模型 · 请到设置中配置</span>
            ) : (
              <span className="text-[10px] text-muted-foreground">你的 AI 智能助手 · 开始对话吧</span>
            )}
            <div className="flex gap-2 text-[9px] text-muted-foreground/50">
              <span>Ctrl+N 新建</span>
              <span>Enter 发送</span>
              <span>Shift+Enter 换行</span>
            </div>
          </div>
        ) : (
          <div style={{ paddingBottom: `${paddingBottom}px`, paddingTop: `${paddingTop}px` }}>
            {virtualItems.map((virtualItem) => {
              const m = state.messages[virtualItem.index];
              if (!m) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="min-w-0"
                >
                  <MessageRow message={m} sessionId={state.sessionId ?? null} isLast={virtualItem.index === state.messages.length - 1} />
                </div>
              );
            })}
          </div>
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
            sessionId={state.sessionId ?? null}
          />
        )}

        {/* ── 活动提示行已取消（🔴 2026-08-23 老大拍板）：宫格底部不再用
            脉冲灯+跳动点重复显示 thinking 内容——思考由流式气泡（ReasoningBlock
            原动画 BrailleSpinner）单一承载，工具进度由流式消息里的 ToolEntry 展示，
            activityHint 行整行移除（与思考气泡动画重复） */}
      </div>

      {/* 🔴 2026-08-17 阶段4：后台会话交互横幅（per-session 并发轮——其他
           会话的审批/澄清/凭据请求可见，点击切到该会话响应） */}
      {backgroundInteractions.length > 0 && (
        <div className="flex flex-col gap-1 px-2.5 pt-1.5 shrink-0">
          {backgroundInteractions.map(([sid, it]) => (
            <button
              key={sid}
              className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-left text-[11px] text-warning hover:bg-warning/20"
              onClick={() => onSwitchSession?.(sid)}
              title={`会话 ${sid} 有待响应交互，点击切换`}
            >
              <span className="font-medium">⚡ {it.kind === 'approval' ? '待审批' : it.kind === 'clarify' ? '待澄清' : it.kind === 'sudo' ? '待 sudo' : '待凭据'} · {sid.length > 16 ? `${sid.slice(0, 8)}…${sid.slice(-6)}` : sid}</span>
              <span className="opacity-70">切换 →</span>
            </button>
          ))}
        </div>
      )}
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
            onDone={() => onClearPending(name, 'approval', slotSid)}
          />
        </div>
      )}
      {clarify && (
        <div className="pb-1.5 shrink-0">
          <ClarifyCard
            clarifyId={clarify.clarify_id}
            question={clarify.question}
            choices={clarify.choices}
            multiSelect={clarify.multi_select}
            profile={name}
            onDone={() => onClearPending(name, 'clarify', slotSid)}
          />
        </div>
      )}
      {clarifyBatch && (
        <div className="pb-1.5 shrink-0">
          <ClarifyBatchCard
            clarifyId={clarifyBatch.clarify_id ?? ''}
            title={clarifyBatch.title}
            questions={clarifyBatch.questions ?? []}
            profile={name}
            onDone={() => onClearPending(name, 'clarify_batch', slotSid)}
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
              onClearPending(name, 'sudo', slotSid);
            }}
            onDismiss={() => onClearPending(name, 'sudo', slotSid)}
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
              onClearPending(name, 'secret', slotSid);
            }}
            onDismiss={() => onClearPending(name, 'secret', slotSid)}
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

      {/* 🔴 2026-08-16 DSH TodoPanel 对齐（宫格）：任务状态折叠条。 */}
      <div className="shrink-0">
        <TodoPanel sessionId={state.sessionId ?? undefined} />
      </div>
      {/* 🔴 2026-08-15 DSH GoalBar 对齐（宫格）：进行中目标显示框。
          普通文档流（对齐单视图 InputArea）：消息区 → 本框 → composer。 */}
      <div className="px-2.5 pb-1 shrink-0">
        <GoalBar sessionId={state.sessionId ?? undefined} />
      </div>

      {/* 🔴 2026-08-15 排队面板改弹层（DSH QueueDock 对齐，与单视图同交互）：
          原常驻展开 QueuePanel 移除 → composer 按钮栏 Layers 按钮开合，
          弹层锚定 composer 上缘向上弹出（覆盖消息区下部，max-h 防出卡）。 */}
      <div className="relative">
        {queueOpen && queueEntries.length > 0 && (
          <div
            ref={queuePopupRef}
            className="absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-56 overflow-y-auto"
          >
            <QueuePanel
              entries={queueEntries}
              busy={streaming}
              subagentActive={subagentActive}
              editingId={queueEdit?.entryIndex ?? null}
              onDelete={(index) => {
                // 🔴 P3-3：编辑态激活时先退出（恢复草稿）——删除导致后续行 index
                // 前移，残留 queueEdit.entryIndex 会指向错行
                const restored = queueEdit ? exitQueueEdit('cancel', composerRef.current?.getValue() ?? '') : null;
                if (restored !== null) composerRef.current?.setValue(restored);
                // 🔴 2026-08-16（审计 C2）：删除成功后移除聊天区乐观气泡（防残留
                // 无回复气泡）；expected_text CAS 防快照漂移删错条目
                const entry = queueEntries[index];
                void (async () => {
                  const ok = await queueRemove(index, entry?.text ?? '');
                  if (ok && entry) {
                    onQueueBubbleSync?.({ type: 'remove', text: entry.text, mediaCount: entry.media_count });
                  }
                })();
              }}
              onEdit={(entry) => beginQueueEdit(entry, composerRef.current?.getValue() ?? '')}
              onSendNow={(index) => {
                // 🔴 P3-3：同删除——steer 移除条目同样引起 index 漂移
                const restored = queueEdit ? exitQueueEdit('cancel', composerRef.current?.getValue() ?? '') : null;
                if (restored !== null) composerRef.current?.setValue(restored);
                void queueSteer(index);
              }}
            />
          </div>
        )}

      {/* ── 输入区 — 全功能紧凑 Composer（自动撑大 + slash 补全 + 新建/附件/语音/发送）── */}
      <AgentCardComposer
        ref={composerRef}
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
        attachedFiles={attachedFiles}
        fileAttaching={fileAttaching}
        fileError={fileError}
        onRemoveFile={removeFileAttachment}
        onClearFileError={clearFileError}
        queueEditingId={queueEdit?.entryIndex ?? null}
        onQueueStep={(dir) => stepQueueEdit(dir, composerRef.current?.getValue() ?? '')}
        onQueueExit={(action) => exitQueueEdit(action, composerRef.current?.getValue() ?? '')}
        onQueueLoadText={(text) => composerRef.current?.setValue(text)}
        queueCount={queueEntries.length}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((v) => !v)}
      />
      </div>
    </div>
  );
});

export default AgentChatCard;
