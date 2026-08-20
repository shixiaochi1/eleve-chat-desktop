/**
 * ProfilePanel — Agent 面板（多 Profile 选择器 + 新建 + 删除）
 *
 * 每个 Profile（Agent 身份）一张卡片，显示 model/provider/技能数/default 徽章。
 * 点选卡片 → 切换 active profile → 通知 App 切换聊天区 + 设置上下文。
 * 底部操作栏：新建 Agent（内联表单）+ 刷新 + 统计。
 * 删除：非 default 卡片 hover 显示垃圾桶 → 输名字强确认 → 移入回收站（可恢复）。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchProfiles, deleteProfile, getProfileAvatar } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { cn } from '@/lib/utils';
import { useSortableList } from '../hooks/useSortableList';
import {
  Bot, Cpu, Plug, Package, Star, Loader,
  Plus, Trash2,
} from 'lucide-react';
import CreateAgentDialog from './CreateAgentDialog';
import { AgentAvatarSvg } from '../lib/agent-avatars';
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
    <span className="flex items-center justify-center w-full h-full text-xs font-semibold uppercase" style={{ color: color || undefined }}>
      {name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function ProfileCard({
  profile, active, switching, onSelect, onDelete, onEdit,
}: {
  profile: ProfileCardData;
  active: boolean;
  switching: boolean;
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
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(profile.name)}
      onDoubleClick={() => onEdit?.(profile.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(profile.name); } }}
      className={cn(
        'group relative w-full text-left px-2.5 py-2 rounded-lg border bg-card shadow-sm transition-all duration-150 cursor-pointer overflow-hidden space-y-1.5 hover:bg-accent/30',
        // 🔴 2026-08-18 选中入场扫光（一次性高光扫过，切换选中时重播）
        active && 'card-selected-sweep',
        switching && 'opacity-60'
      )}
      style={{
        '--agent-color': color ?? undefined,
        // 🔴 卡片描边 = accent 30% 透明混合（选中/未选中一致；无 color = 主题 primary）
        borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`,
        // 🔴 2026-08-18 老大需求：选中态填充同背景色——不再混入 accent 10% 淡底，
        // 选中标识只靠描边 + 光环 + 左侧发光竖条（bg-card 保持）
        background: undefined,
        // 🔴 选中态背投影（对齐宫格卡片逻辑：细光环 + 明显投影；侧栏卡片小，光环 1px 不显粗）
        boxShadow: active
          ? `0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent), 0 6px 18px var(--theme-shadow-color-heavy)`
          : undefined,
      } as React.CSSProperties}
    >
      {/* 左侧 accent 强调条：仅选中态渲染（实色+发光）；无 color 用主题 primary */}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
          style={{
            background: accent,
            boxShadow: `0 0 8px color-mix(in srgb, ${accent} 65%, transparent)`,
          }}
        />
      )}
      {/* 名称行 */}
      <div className="flex items-center gap-1.5">
        {/* 头像容器：恒无方块背景（老大 2026-08-12：与项目卡片一致，选中强调靠描边+淡底+光环） */}
        <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 overflow-hidden transition-all duration-150">
          {profile.avatar || profile.avatar_key ? (
            <ProfileAvatar name={profile.display_name || profile.name} hasAvatar={profile.avatar} color={color} avatarKey={profile.avatar_key} />
          ) : (
            <Bot size={13} strokeWidth={1.5} style={{ color: color || undefined }} />
          )}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {profile.display_name || profile.name}
          {profile.display_name && profile.display_name !== profile.name && (
            <span className="ml-1 text-[10px] text-muted-foreground/60 font-normal">({profile.name})</span>
          )}
        </span>
        {profile.is_default && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-muted text-muted-foreground" title="默认 Agent">
            <Star size={9} strokeWidth={1.5} />
            默认
          </span>
        )}
        {switching ? (
          <Loader size={12} strokeWidth={1.5} className="animate-spin text-primary" />
        ) : null}
        {/* 删除按钮（非 default，hover 显示） */}
        {!profile.is_default && onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile.name); }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
            title={`删除 ${profile.name}`}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* 元信息（🔴 2026-08-13 v6 等高保障：flex-nowrap 禁换行——provider 有无不再
          导致卡片高度差异；切 Agent 数量不变 → 列表总高恒定 → 项目区零移动） */}
      <div className="flex items-center gap-1.5 pl-7 min-w-0">
        {profile.model ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="模型">
            <Cpu size={9} strokeWidth={1.5} />
            <span className="truncate max-w-[90px]">{profile.model}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">未配置模型</span>
        )}
        {profile.provider && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="提供方">
            <Plug size={9} strokeWidth={1.5} />
            <span className="truncate max-w-[70px]">{profile.provider}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="技能数">
          <Package size={9} strokeWidth={1.5} />
          <span>{profile.skill_count}</span>
        </span>
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
  // Agent 卡片实际高度（测量校准；初始估算 = 标题行 + 元信息行 + padding）
  const [cardH, setCardH] = useState(68);

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
  const sortable = useSortableList({
    ids: orderedProfiles.map((p) => p.name),
    onReorder: (ids) => { setAgentOrder(ids); saveAgentOrder(ids); },
    itemHeight: cardH,
    gap: 6,
    padTop: 6,
  });
  // 首张卡测量实际高度（校准槽位间距）
  const measureFirstCard = useCallback((el: HTMLDivElement | null) => {
    if (el && cardH === 68) {
      const h = el.getBoundingClientRect().height;
      if (h > 20 && Math.abs(h - 68) > 2) setCardH(h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardH]);

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

      {/* Agent 卡片列表（绝对定位 + transform 槽位，拖拽排序；pt/pb 并入 sortable padTop/
          容器高度，[scrollbar-gutter:stable] 恒预留滚动条位与项目列表宽度对齐）
          🔴 data-agent-list：AgentsPanel 高度测量锚点（scrollHeight = 内容总高，不受容器裁剪影响） */}
      <div
        data-agent-list
        ref={sortable.containerRef}
        onPointerDown={sortable.onPointerDown}
        className="relative flex-1 overflow-y-auto px-3 min-h-0 [scrollbar-gutter:stable]"
        style={{ height: sortable.contentHeight() + 12 }}
      >
        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">加载中...</div>
        ) : (
          orderedProfiles.map((p, i) => (
            <div
              key={p.name}
              ref={(el) => {
                sortable.registerItem(p.name, el);
                if (i === 0) measureFirstCard(el);
              }}
              data-sortable-id={p.name}
              className="absolute top-0 left-0"
              style={{ width: 'calc(100% - 24px)', height: cardH }}
            >
              {/* 整卡可拖（4px 阈值区分点击=聚焦/拖动=换位；按钮/输入已排除） */}
              <div data-drag-handle className="h-full cursor-grab active:cursor-grabbing">
                <ProfileCard
                  profile={p}
                  active={p.name === activeName}
                  switching={switching === p.name}
                  onSelect={handleSelect}
                  onEdit={onEditAgent}
                  onDelete={(name) => { setDeletingTarget(name); setDeleteConfirmName(''); }}
                />
              </div>
            </div>
          ))
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
              className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
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
