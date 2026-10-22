/**
 * ProfilePanel — Agent 面板（多 Profile 选择器 + 新建 + 删除）
 *
 * 每个 Profile（Agent 身份）一张卡片，显示 model/provider/技能数/default 徽章。
 * 点选卡片 → 切换 active profile → 通知 App 切换聊天区 + 设置上下文。
 * 底部操作栏：新建 Agent（内联表单）+ 刷新 + 统计。
 * 删除：非 default 卡片 hover 显示垃圾桶 → 输名字强确认 → 移入回收站（可恢复）。
 */
import { useState, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { fetchProfiles, deleteProfile, getProfileAvatar } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { cn } from '@/lib/utils';
import { useSortableList } from '../hooks/useSortableList';
import {
  Bot, Star, Loader,
  Plus, Trash2,
} from 'lucide-react';
import CreateAgentDialog from './CreateAgentDialog';
import { AgentAvatarSvg } from '../lib/agent-avatars';
import { useUnionRoster } from '../plugins/bots/state';
import { LOCAL_CONNECTION_ID } from '../services/bot-relay';
import { isBotWorkerActive, isGatewayBusy } from '../lib/bot-activity';
import { formatChatListTime } from '../lib/relative-time';
import { useBotUnread } from '../hooks/useBotUnread';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';

interface ProfileCardData {
  name: string;
  display_name?: string | null;
  /** Agent 主题色（#RRGGBB，来自后端 profile.yaml color，仅 UI） */
  color?: string | null;
  /** 是否有头像（有图显示图，无图显示首字母 glyph） */
  avatar?: boolean;
  /** 默认头像 key（预设头像库，随主题色渲染 SVG） */
  avatar_key?: string | null;
  path: string;
  is_default: boolean;
  is_active: boolean;
  has_env: boolean;
  model: string | null;
  provider: string | null;
  skill_count: number;
}

interface ProfilePanelProps {
  currentProfile?: string;
  onProfileChange?: (name: string) => void;
  /** 🔴 宫格按钮修复：profile 列表变化时上抛数量，App 据此驱动 agentCount（消灭平行数据源） */
  onProfilesChange?: (count: number) => void;
  /** 🔴 昵称全局生效：上抛 name → display_name 映射，App 据此让状态栏/会话列表显示昵称而非 ID */
  onDisplayNamesChange?: (map: Record<string, string>) => void;
  /** 🔴 颜色全局生效：上抛 name → color 映射，App 据此让编辑面板/宫格卡片显示主题色 */
  onColorsChange?: (map: Record<string, string>) => void;
  /** 🔴 默认头像 key 上抛：name → avatar_key（App 传给编辑面板初始值） */
  onAvatarKeysChange?: (map: Record<string, string>) => void;
  /** 双击 Agent 卡片 → 打开编辑面板（App 层渲染 EditAgentDialog） */
  onEditAgent?: (name: string) => void;
  /** 🔴 编辑保存后自增：触发重新拉取列表（昵称/颜色热更新，不依赖重启） */
  refreshSignal?: number;
  [key: string]: unknown;
}

// ── 单个 Agent 卡片 ──
/** 🔴 2026-08-02 头像：默认头像 key → 主题色 SVG；有上传图 → 懒加载 img；无 → 首字母 glyph */
function ProfileAvatar({ name, hasAvatar, color, avatarKey }: { name: string; hasAvatar?: boolean; color?: string | null; avatarKey?: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasAvatar || avatarKey) { setSrc(null); return; }
    let cancelled = false;
    getProfileAvatar(name)
      .then((res) => { if (!cancelled && res?.exists && res.data) setSrc(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [name, hasAvatar, avatarKey]);

  if (avatarKey) {
    return (
      <span className="block w-full h-full p-[3px]" style={{ color: color || undefined }}>
        <AgentAvatarSvg avatarKey={avatarKey} color={color || 'currentColor'} />
      </span>
    );
  }
  if (src) {
    return <img src={src} alt="" className="w-full h-full object-cover" />;
  }
  return (
    <span className="flex items-center justify-center w-full h-full text-base font-semibold uppercase" style={{ color: color || undefined }}>
      {name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function ProfileCard({
  profile, active, switching, runtime, unreadKey, isLast, onSelect, onDelete, onEdit,
}: {
  profile: ProfileCardData;
  active: boolean;
  switching: boolean;
  /** 运行态（来自 union roster 本机行）：busy = worker 在跑或 gateway 忙 */
  runtime?: {
    busy: boolean;
    lastActive: number | null;
    /** 与 Agent 的 canonical 私聊最后一条消息（后端 sessions 冗余快照） */
    lastMessage?: { text: string; at: number } | null;
  };
  /** 未读订阅键（`canonical_session_id ?? profile`，与 useBotUnread 同一公式） */
  unreadKey?: string;
  /** 列表最后一行不画分隔线（微信联系人列表同款） */
  isLast?: boolean;
  onSelect: (name: string) => void;
  onDelete?: (name: string) => void;
  onEdit?: (name: string) => void;
}) {
  // 🔴 2026-08-02 卡片主题色联动：选中/未选中/头像全链路应用 Agent 主题色。
  // 无主题色（color 为 null）时回退原样式（primary 边框 + accent 背景）。
  const color = profile.color || null;
  // 🔴 2026-08-12 老大指正：点选状态统一为"给了颜色"的样式——无 color 时颜色 = 主题
  //   primary（var(--dt-primary)），不再出现"裸勾/无竖条"第二形态。Agent 与项目卡片同构。
  const accent = color ?? 'var(--dt-primary)';
  // 🔴 2026-10-22 用户要求：AGENT 行做成**微信聊天联系人行**——
  //   大头像 + 名称/时间 + 最后一条消息预览/未读红点，分隔线从文字起点开始。
  //   model/provider/技能数收进 title 提示（不进行内，保持单行信息的呼吸感）。
  const displayName = profile.display_name || profile.name;
  const meta = [
    profile.name !== displayName ? profile.name : null,
    profile.model || '未配置模型',
    profile.provider,
    `${profile.skill_count} 技能`,
  ].filter(Boolean).join(' · ');
  // 未读：订阅该 Agent canonical 私聊的未读标志（无键回退 profile，与 ingest 同公式）
  const unread = useBotUnread(unreadKey || profile.name);
  const lastMessage = runtime?.lastMessage ?? null;
  const preview = (lastMessage?.text ?? '').replace(/\s+/g, ' ').trim();
  const activityAt = lastMessage?.at || runtime?.lastActive || 0;
  const subText = preview || (runtime?.busy ? '正在处理…' : '还没有消息');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(profile.name)}
      onDoubleClick={() => onEdit?.(profile.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(profile.name); } }}
      title={meta}
      className={cn(
        'group relative w-full h-full flex items-center gap-2.5 pl-2.5 pr-2 cursor-pointer transition-colors overflow-hidden',
        active ? 'bg-accent/50' : 'hover:bg-accent/30',
        switching && 'opacity-60'
      )}
    >
      {/* 头像（微信式 40px 圆角方；运行中 = 右下角绿点；选中 = accent 细描边） */}
      <div
        className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center transition-shadow"
        style={active ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${accent} 45%, transparent)` } : undefined}
      >
        {profile.avatar || profile.avatar_key ? (
          <ProfileAvatar name={displayName} hasAvatar={profile.avatar} color={color} avatarKey={profile.avatar_key} />
        ) : (
          <Bot size={22} strokeWidth={1.5} style={{ color: color || undefined }} />
        )}
        {runtime?.busy && (
          <span
            className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-card"
            title="运行中（切走不会中断）"
          />
        )}
      </div>

      {/* 右侧两行（微信联系人同构）：名称 + 时间 / 最后一条消息 + 未读红点。
          分隔线画在内容列上 → 从文字起点开始，而不是通栏。 */}
      <div
        className={cn(
          'min-w-0 flex-1 self-stretch flex flex-col justify-center gap-0.5',
          !isLast && 'border-b border-[var(--ui-stroke-quaternary)]'
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn('truncate flex-1 text-[13px]', active ? 'font-medium text-foreground' : 'text-foreground/90')}>
            {displayName}
          </span>
          {profile.is_default && (
            <span className="shrink-0" title="默认 Agent">
              <Star size={10} strokeWidth={1.5} className="text-muted-foreground/50" />
            </span>
          )}
          {switching && <Loader size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-primary" />}
          {/* 时间：hover 时让位给删除（微信行没有删除，但管理能力要保留） */}
          <span
            className={cn(
              'shrink-0 text-[10px] tabular-nums text-muted-foreground/50',
              !profile.is_default && onDelete && 'group-hover:hidden'
            )}
          >
            {formatChatListTime(activityAt)}
          </span>
          {!profile.is_default && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(profile.name); }}
              className="hidden group-hover:flex shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={`删除 ${profile.name}`}
            >
              <Trash2 size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              'truncate flex-1 text-[11px]',
              !preview && runtime?.busy ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/70'
            )}
          >
            {subText}
          </span>
          {unread && (
            <span className="shrink-0 h-2 w-2 rounded-full bg-destructive" title="有未读消息" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主面板 ──
// 🔴 2026-08-20：Agent 卡片手动拖拽排序（对齐项目面板 order 模式：
// localStorage 持久化，用户拖拽覆盖后端顺序，新 Agent 追加底部）
const AGENT_ORDER_KEY = 'eleve.sidebarAgentOrder.v1';
function loadAgentOrder(): string[] {
  try {
    const raw = localStorage.getItem(AGENT_ORDER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function saveAgentOrder(ids: string[]): void {
  try { localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

export default function ProfilePanel({ currentProfile, onProfileChange, onProfilesChange, onDisplayNamesChange, onColorsChange, onAvatarKeysChange, onEditAgent, refreshSignal }: ProfilePanelProps) {
  const [profiles, setProfiles] = useState<ProfileCardData[]>([]);
  // 🔴 高亮唯一权威源 = App 的 currentProfile（UI 焦点 ①），经 prop 下发，不读后端 active_profile（③）。
  // 决策④：UI 切换不写 ③，故 ③ 恒为系统默认（CLI 权威）；若拿 ③ 当高亮源，点选后 load() 会把高亮弹回 default。
  const activeName = currentProfile || 'default';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  // 手排顺序：用户拖拽覆盖后端顺序；新 Agent（未在 order）追加底部
  const [agentOrder, setAgentOrder] = useState<string[]>(() => loadAgentOrder());
  // Agent 行高（测量校准；微信联系人行 = 40 头像 + 上下 8px）
  // 🔴 2026-10-23：头像行 → 微信联系人行（两行文本），行高 34 → 56。
  const [cardH, setCardH] = useState(56);

  // 🔴 运行态（2026-10-22）：Agent 行 = 工作区级导航，切走即失去该 Agent 的流式焦点，
  // 所以在行上显式标"运行中"。数据取 union roster 的**本机行**（远端 Agent 不在卡片区）。
  // 🔴 2026-10-23：微信式行还需要「最后一条消息预览 + 未读键」——同一份 roster 行取齐。
  const roster = useUnionRoster();
  const runtimeByName = useMemo(() => {
    const m = new Map<string, {
      busy: boolean;
      lastActive: number | null;
      lastMessage: { text: string; at: number } | null;
      unreadKey: string;
    }>();
    for (const row of roster) {
      if (row.connectionId !== LOCAL_CONNECTION_ID) continue;
      const name = row.entry.profile;
      if (!name) continue;
      m.set(name, {
        busy: isBotWorkerActive(row.entry.worker_session) || isGatewayBusy(row.entry.busy),
        lastActive: row.entry.last_active ?? null,
        lastMessage: row.entry.last_message ?? null,
        // 未读键公式与 useBotUnread.ingest 同源（canonical_session_id ?? profile）
        unreadKey: row.entry.canonical_session_id || name,
      });
    }
    return m;
  }, [roster]);

  // 渲染顺序：order 优先 + 新增追加（对齐项目 orderProjectsByIds 语义）
  const orderedProfiles = useMemo(() => {
    const known = new Set(agentOrder);
    const kept = agentOrder
      .map((n) => profiles.find((p) => p.name === n))
      .filter((p): p is ProfileCardData => !!p);
    const added = profiles.filter((p) => !known.has(p.name));
    return [...kept, ...added];
  }, [profiles, agentOrder]);

  // 拖拽排序 hook（指针跟手 + FLIP 让位动画）
  // 🔴 2026-08-20 滚动条修复：拖拽中被拖卡 transform 超出容器边界 → absolute 溢出
  // 撑大 scrollHeight → 内容未超限也闪滚动条。拖拽期间容器 overflow-hidden（边缘
  // 自动滚动仍走 scrollTop 编程设置，overflow:hidden 下有效），松手恢复 auto。
  const [draggingAgent, setDraggingAgent] = useState(false);
  const sortable = useSortableList({
    ids: orderedProfiles.map((p) => p.name),
    onReorder: (ids) => { setAgentOrder(ids); saveAgentOrder(ids); },
    itemHeight: cardH,
    // 微信联系人列表行紧贴（分隔线由行内内容列绘制，不靠间距）
    gap: 0,
    padTop: 4,
    onDragStateChange: ({ activeId }) => setDraggingAgent(!!activeId),
  });
  // 首个行测量实际高度（校准槽位间距）
  const measureFirstCard = useCallback((el: HTMLDivElement | null) => {
    if (el && cardH === 56) {
      const h = el.getBoundingClientRect().height;
      if (h > 20 && Math.abs(h - 56) > 2) setCardH(h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardH]);

  // 🔴 2026-08-20 拖拽排序修复：absolute 卡片靠 transform 槽位定位，
  // 必须经 settleAll 归位（初始渲染 + ids/卡片高度变化时）——否则所有卡片
  // transform 为空叠在 top-0（"默认卡片消失"根因）。
  // 无动画模式：初始渲染直接定位无闪烁；拖拽中的让位/归位动画由 hook
  // 内部（onWindowMove setSlot(true) + onWindowUp setSlot 投影槽位）负责。
  // 🔴 2026-08-20 叠加修复：依赖加 orderedProfiles（顺序引用）——拖拽提交
  // 后长度不变但顺序变了，只依赖 length 不会重跑 → 被拖项残留脏 transform。
  const { settleAll } = sortable;
  useLayoutEffect(() => {
    settleAll(undefined, false);
  }, [settleAll, orderedProfiles, cardH]);

  // ── 对话框状态（新建/删除均为独立弹窗，不与卡片列表混排） ──
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data.profiles as ProfileCardData[]);
      // 🔴 不用 data.active（③）覆盖高亮 —— ③ 是系统默认（CLI 权威），非 UI 选择源。
      // 高亮由 currentProfile prop 派生（见 activeName）；load 只刷新列表数据（model/技能数/统计）。
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);


  // 🔴 冷启动竞态修复：mount 时 WS 可能未连（后端启动慢），sendRpc 在 disconnected 态必 reject
  // （不排队）→ 旧实现直接显示 "WebSocket not connected (state=disconnected)" 错误横幅，
  // 切走再切回（重挂载）时才消失。改为等 WS 连接后再 load（对齐 App 启动链补拉模式）。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) void load(); })
      .catch(() => { if (!cancelled) setError('无法连接网关，请检查后端服务'); });
    return () => { cancelled = true; };
  }, [load]);

  // 🔴 宫格按钮修复：列表数据变化（建/删/手动刷新）时上抛数量。
  // App.agentCount 为唯一持有者，初始值由 portReady fetch 兜底，运行期由此回调驱动。
  useEffect(() => { onProfilesChange?.(profiles.length); }, [profiles, onProfilesChange]);

  // 🔴 昵称全局生效：上抛 name → display_name 映射（App 驱动状态栏/会话列表显示昵称）
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) map[p.name] = p.display_name || p.name;
    onDisplayNamesChange?.(map);
  }, [profiles, onDisplayNamesChange]);

  // 🔴 颜色全局生效：上抛 name → color 映射（App 驱动编辑面板初始色/宫格卡片主题色）
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) {
      if (p.color) map[p.name] = p.color;
    }
    onColorsChange?.(map);
  }, [profiles, onColorsChange]);

  // 🔴 默认头像 key 上抛（App 驱动编辑面板初始头像）
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) {
      if (p.avatar_key) map[p.name] = p.avatar_key;
    }
    onAvatarKeysChange?.(map);
  }, [profiles, onAvatarKeysChange]);

  // 🔴 编辑面板保存后热更新：refreshSignal 自增 → 重新拉取列表（昵称/颜色即时生效）
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === 0) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const handleSelect = useCallback((name: string) => {
    if (name === activeName) return;
    setSwitching(name);
    try {
      // 🔴 决策④：UI 切换 = 纯前端操作，不调后端 set_active（不写 active_profile 文件）。
      // Agent 间零共享可变状态，切换只是换显示界面。
      // 高亮不在此 setState —— onProfileChange 更新 App.currentProfile，经 prop 回流驱动 activeName（受控单向流）。
      onProfileChange?.(name);
    } finally {
      setSwitching(null);
    }
  }, [activeName, onProfileChange]);

  const handleDelete = useCallback(async () => {
    if (!deletingTarget || deleteConfirmName !== deletingTarget || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await deleteProfile(deletingTarget);
      notifySuccess(`Agent「${deletingTarget}」已移入回收站`);
      if (deletingTarget === currentProfile) {
        onProfileChange?.('default');
      }
      setDeletingTarget(null);
      setDeleteConfirmName('');
      void load();
    } catch (err: unknown) {
      notifyError(err, `删除 ${deletingTarget} 失败`);
    } finally {
      setDeletingBusy(false);
    }
  }, [deletingTarget, deleteConfirmName, deletingBusy, load, currentProfile, onProfileChange]);

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* ── 区块头：AGENTS + 计数 + 刷新/新建（relative = 新建浮层锚点） ── */}
      <div data-agent-header className="relative flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 select-none">Agents</span>
        {!loading && profiles.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/40">{profiles.length}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => { setDeletingTarget(null); setCreateOpen(true); }}
            className="inline-flex items-center gap-1.5 pl-1 pr-2.5 h-[22px] rounded-full text-[11px] leading-normal font-semibold transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.12),0_3px_8px_var(--theme-shadow-color)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.16),0_6px_16px_var(--theme-shadow-color-heavy)] hover:brightness-[1.06] hover:-translate-y-[1.5px] shrink-0"
            title="新建 Agent"
          >
            <Plus size={12} strokeWidth={2.5} className="shrink-0" />
            新建 Agent
          </button>
          {/* ── 新建 Agent 弹出卡片（锚定按钮下方，高度自适应不裁剪） ── */}
          {createOpen && (
            <CreateAgentDialog
              onClose={() => setCreateOpen(false)}
              onCreated={() => void load()}
              onProfileChange={onProfileChange}
              profiles={profiles}
            />
          )}
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="mx-3 mb-1 px-2 py-1 text-[11px] text-destructive bg-destructive/5 rounded border border-destructive/20 shrink-0">{error}</div>
      )}

      {/* Agent 卡片列表（拖拽排序：absolute 卡片 + transform 槽位）
          🔴 2026-08-20 高度方案（用户要求内容驱动）：容器不给固定高度——
          内部放"占位撑高层"（高度 = 卡片总高 + padding），容器自然高度由
          占位层撑开 → Agent 区高度 = 卡片数量总高（内容驱动），卡片少时
          项目区自动上移（AgentsPanel 下部 flex-1）；卡片多时由 AgentsPanel
          上部 max-h-[42%] 压缩 + 本容器 overflow-y-auto 滚动。
          🔴 data-agent-list：AgentsPanel 高度测量锚点（scrollHeight = 内容总高） */}
      <div
        data-agent-list
        ref={sortable.containerRef}
        onPointerDown={sortable.onPointerDown}
        className={cn(
          'relative overflow-y-auto px-3 min-h-0 [scrollbar-gutter:stable]',
          // 🔴 2026-08-20 拖拽滚动条修复：拖拽中 absolute 卡片溢出撑大 scrollHeight
          // → 内容未超限也闪滚动条；overflow-hidden 期间边缘自动滚动（scrollTop 编程）
          // 仍有效，松手恢复 auto
          draggingAgent && 'overflow-y-hidden'
        )}
      >
        {/* 占位撑高：absolute 卡片的"流内"锚点——容器自然高度 = 卡片总高 */}
        <div aria-hidden className="w-full" style={{ height: sortable.contentHeight() + 12 }} />
        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">加载中...</div>
        ) : (
          orderedProfiles.map((p, i) => {
            const rt = runtimeByName.get(p.name);
            return (
              <div
                key={p.name}
                ref={(el) => {
                  sortable.registerItem(p.name, el);
                  if (i === 0) measureFirstCard(el);
                }}
                data-sortable-id={p.name}
                className="absolute top-0"
                style={{ left: 4, width: 'calc(100% - 8px)', height: cardH }}
              >
                {/* 整行可拖（4px 阈值区分点击=聚焦/拖动=换位；按钮/输入已排除） */}
                <div data-drag-handle className="h-full cursor-grab active:cursor-grabbing">
                  <ProfileCard
                    profile={p}
                    active={p.name === activeName}
                    switching={switching === p.name}
                    runtime={rt}
                    unreadKey={rt?.unreadKey ?? p.name}
                    isLast={i === orderedProfiles.length - 1}
                    onSelect={handleSelect}
                    onEdit={onEditAgent}
                    onDelete={(name) => { setDeletingTarget(name); setDeleteConfirmName(''); }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── 新建 Agent 弹出卡片（渲染于区块头内 = 锚点） ── */}

      {/* ── 删除确认对话框（输名字强确认，可恢复） ── */}
      <Dialog open={!!deletingTarget} onOpenChange={(v) => { if (!v && !deletingBusy) { setDeletingTarget(null); setDeleteConfirmName(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-destructive">
              <Trash2 size={15} strokeWidth={2} />
              删除 Agent「{deletingTarget}」
            </DialogTitle>
            <DialogDescription>
              将移入回收站（可恢复）。该 Agent 自己的配置、凭证、会话、记忆一并移走，不影响其它 Agent。
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { void handleDelete(); }
              if (e.key === 'Escape') { setDeletingTarget(null); setDeleteConfirmName(''); }
            }}
            placeholder={`输入「${deletingTarget}」确认删除`}
            autoFocus
            disabled={deletingBusy}
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-destructive/40 bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-destructive/50 disabled:opacity-50"
          />
          <DialogFooter className="mt-1">
            <button
              onClick={() => { setDeletingTarget(null); setDeleteConfirmName(''); }}
              disabled={deletingBusy}
              className="px-3 py-1.5 text-xs rounded-md border border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={deleteConfirmName !== deletingTarget || deletingBusy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deletingBusy ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : <Trash2 size={13} strokeWidth={2} />}
              删除
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
