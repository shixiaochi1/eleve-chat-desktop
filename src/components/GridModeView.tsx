/**
 * GridModeView — 多 Agent 宫格全功能视图（模式 B）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  多 Profile 宫格视图 — 生命周期与数据流架构
 * ═══════════════════════════════════════════════════════════════════
 *
 * 【挂载/卸载生命周期】
 *
 *   App 条件渲染: viewMode === 'grid' ? <GridModeView/> : <单视图/>
 *
 *   挂载时:
 *     1. fetchProfiles() 获取所有 Agent 列表
 *     2. 读 localStorage profile_session_map 获取每个 Agent 上次的 session 指针
 *     3. 🔴 串台防御: sessionIdMatchesProfile() 校验指针归属，不匹配则跳过
 *     4. 对通过校验的 profile 调 loadLatest() 从后端加载最新 N 条消息
 *     5. useGridChat(active=true) 注册 WS listener，接管所有事件
 *
 *   卸载时:
 *     1. persistPointers() 把各 Agent 当前 sessionId 写回 profile_session_map
 *     2. useGridChat(active=false) 卸载 WS listener
 *     3. App 层同步恢复 useSSE(enabled=true)
 *
 * 【profile_session_map 数据流（localStorage 持久化）】
 *
 *   结构: { "default": "agent:default:ws:xxx", "ocean": "agent:ocean:ws:yyy", ... }
 *
 *   写入点:
 *     - persistPointers()（退出宫格/展开单 Agent 时）
 *     - App.handleProfileChange()（单视图切换 Agent 时）
 *
 *   读取点:
 *     - 本组件进入宫格时（初始化各 Agent 卡片）
 *     - App 启动恢复时（恢复上次使用的 session）
 *     - App.handleProfileChange()（切换到目标 Agent 时）
 *
 *   🔴 污染风险: map 中的指针可能被错误写入（如旧版全局 session_id fallback），
 *   所有读取点必须经 sessionIdMatchesProfile() 校验后才能消费。
 *   详见 utils/session.ts 文件头的完整架构文档。
 *
 * 【布局与拖拽】
 * - 卡片绝对定位 + transform translate（非 grid 流式布局）
 * - 列数按容器宽度 auto-fill 计算（MIN_CELL_W），N 无上限可滚动
 * - 拖拽换位零 React 渲染：被拖卡直接写 DOM transform，松手提交 order
 *
 * 【与单视图的关系】
 *   宫格和单视图共享同一个 WS 连接（ws-client 单例），但事件消费者互斥：
 *   宫格 → useGridChat 按 session_id 解复用到 N 个状态槽
 *   单视图 → useSSE 按当前 sessionId 过滤
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { fetchProfiles } from '../utils/api';
import { Square } from 'lucide-react';
import { useGridChat, type AgentChatState } from '../hooks/useGridChat';
import AgentChatCard, { type AgentProfileInfo, type AgentCardColor } from './AgentChatCard';
import { ArtifactPreviewOverlay } from './ArtifactCard';
import { getWsClient } from '../services/ws-client';
import { sessionIdMatchesProfile, persistSessionPointer, loadProfilePointers, batchSaveProfilePointers } from '../utils/session';

/**
 * 🔴 GridModeView 命令式句柄 — App 经 gridRef 调度宫格（修复 BUG2 + 退出持久化权威收敛）
 *
 * useGridChat 封装在 GridModeView 内部（仅 grid 挂载），App 无法直接调。
 * 暴露两个命令：
 *   - switchToSession(profile, sessionId)：宫格内切换某 Agent 卡片的会话（不换视图模式）
 *   - persistPointers()：退出宫格前把各 Agent 最新 session 指针写回 localStorage
 */
export interface GridModeViewHandle {
  switchToSession: (profile: string, sessionId: string) => void;
  persistPointers: () => void;
  /** 侧栏"新建会话"路由进宫格：重置焦点 Agent 卡片 + 全局副作用 */
  newSession: (profile: string) => void;
  /** 宫格内执行 slash 命令（CommandCenter CMD+K 路由用） */
  execCommand: (profile: string, cmdName: string, args: string) => void;
  /** 🔴 编辑面板保存后热刷新：重新拉 Agent 列表（昵称/颜色即时生效，不依赖重启） */
  refreshProfiles: () => Promise<void>;
}

// ── Agent 颜色调色板（对齐 --ui-* 设计 token）──
// ring/bg 用 color-mix 从主题 dot 变量派生，深色/浅色主题自动适配（B5 光晕主题化）
// 🔴 仅作为“未设置 color 的 profile”回退色：已设色的 profile 直接用 profile.color（#RRGGBB）
const AGENT_COLORS: AgentCardColor[] = [
  { dot: 'var(--ui-blue)',   ring: 'color-mix(in srgb, var(--ui-blue) 35%, transparent)',   bg: 'color-mix(in srgb, var(--ui-blue) 6%, transparent)' },
  { dot: 'var(--ui-green)',  ring: 'color-mix(in srgb, var(--ui-green) 35%, transparent)',  bg: 'color-mix(in srgb, var(--ui-green) 6%, transparent)' },
  { dot: 'var(--ui-purple)', ring: 'color-mix(in srgb, var(--ui-purple) 35%, transparent)', bg: 'color-mix(in srgb, var(--ui-purple) 6%, transparent)' },
  { dot: 'var(--ui-orange)', ring: 'color-mix(in srgb, var(--ui-orange) 35%, transparent)', bg: 'color-mix(in srgb, var(--ui-orange) 6%, transparent)' },
];

/** 从 #RRGGBB hex 派生卡片色（dot=hex，ring/bg 用 color-mix 同 AGENT_COLORS 派生规则） */
function cardColorFromHex(hex: string): AgentCardColor {
  return {
    dot: hex,
    ring: `color-mix(in srgb, ${hex} 35%, transparent)`,
    bg: `color-mix(in srgb, ${hex} 6%, transparent)`,
  };
}

// 尚未加载的 profile 的空状态（模块级常量 = 稳定引用，保证 AgentChatCard memo 生效）
const EMPTY_AGENT_STATE: AgentChatState = {
  sessionId: null, messages: [], hasMore: false, oldestId: null,
  isLoadingMore: false, status: 'idle',
  pendingApproval: null, pendingClarify: null, pendingSudo: null, pendingSecret: null,
  pendingSlashConfirm: null, streamParts: [], activityHint: '', sessionTitle: null, modelName: null, lastUsage: null, lastActivity: 0,
};

// ── 布局常量 ──
const GAP = 10;
const PAD = 10;
const MIN_CELL_W = 340;   // 卡片最小宽度（列数 = 容器宽度 auto-fill，且不超过 Agent 数）
const MIN_CELL_H = 320;   // 卡片最小高度（高度随窗口自适应，不足时滚动）
const SWAP_EASE = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
const AUTO_SCROLL_EDGE = 40;   // 拖拽距容器边缘多少 px 触发自动滚动
const AUTO_SCROLL_STEP = 10;

interface ProfileInfo extends AgentProfileInfo {
  skill_count: number;
  is_default: boolean;
}

interface GridModeViewProps {
  currentProfile: string;
  /** App 层当前会话的实时 sessionId（当前 profile 的 map 指针可能陈旧，用此兜底） */
  currentSessionId: string | null;
  onExitGrid: () => void;
  onExpandAgent: (profile: string) => void;
  /** 宫格焦点切换 → 回传 App（侧栏高亮联动） */
  onFocusChange?: (name: string) => void;
  /** 焦点 Agent 的 session 变化 → 上抛 App（侧栏会话列表高亮跟随 focusedAgent） */
  onFocusedSessionChange?: (sessionId: string | null) => void;
  /** 网关就绪（slash 补全拉取命令列表） */
  portReady: boolean;
  /** 新建会话的全局副作用（清 localStorage 指针 + 刷新会话列表），由 App 注入，
   *  复用 handleNewSession 同一套工具链，不重复造轮子 */
  onNewSessionEffects?: (profile: string) => void;
  /** 🔴 M-2 修复：宫格卡片选模型 → 写该卡片 profile 的 config + 切该卡片的 session（per-Agent 模型隔离） */
  onSelectModel?: (profile: string, modelId: string, sessionId?: string | null) => void;
}

/** 拖拽运行时状态（存 ref，拖拽期间零 setState） */
interface DragState {
  name: string;
  el: HTMLDivElement;
  downX: number;
  downY: number;
  grabOffsetX: number;   // 光标距卡片左上角偏移（卡片内坐标，与坐标系无关）
  grabOffsetY: number;
  active: boolean;       // 超过 4px 阈值才视为拖拽
  ring: string;
}

// ── 布局计算：列数按宽度 auto-fill（不超过 Agent 数，少时卡片放大铺满），
//    高度随窗口自适应（铺满可用高度，不足 MIN_CELL_H 时滚动）──
function computeLayout(count: number, W: number, H: number) {
  if (count === 0 || W <= 0 || H <= 0) return { cols: 1, rows: 1, cellW: MIN_CELL_W, cellH: MIN_CELL_H, contentH: 0 };
  const maxColsByWidth = Math.max(1, Math.floor((W - PAD * 2 + GAP) / (MIN_CELL_W + GAP)));
  const cols = Math.max(1, Math.min(count, maxColsByWidth));   // 少于列数上限时卡片放大铺满
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const availableH = H - PAD * 2 - GAP * (rows - 1);
  const cellH = Math.max(MIN_CELL_H, availableH / rows);       // 高度自适应，保证最小可用
  const contentH = PAD * 2 + rows * cellH + (rows - 1) * GAP;
  return { cols, rows, cellW, cellH, contentH };
}

function slotPos(index: number, cols: number, cellW: number, cellH: number) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: PAD + col * (cellW + GAP), y: PAD + row * (cellH + GAP) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const GridModeView = forwardRef<GridModeViewHandle, GridModeViewProps>(function GridModeView({ currentProfile, currentSessionId, onExitGrid, onExpandAgent, onFocusChange, onFocusedSessionChange, portReady, onNewSessionEffects, onSelectModel }, ref) {
  // 🔴 M-1/M-2 修复：不再从 Context 取全局 currentModel（发送链已去 model，
  // 各卡片展示用后端 per-session 推送的 modelName，选择走 onSelectModel 绑定卡片）
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  // 🔴 焦点 = App.currentProfile（单一权威源，与侧栏 ProfilePanel 同模式）。
  // 删本地 focusedName 状态：宫格点选 → onFocusChange → App.currentProfile → prop 回流驱动高亮。
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  // 宫格聊天引擎：挂载即激活（本组件仅 grid 模式挂载）
  const { states, loadLatest, loadMore, sendTo, abortAgent, clearPending, resetAgent, execCommand, handleSlashConfirmDone, sendQueueNow, deleteQueueEntry } = useGridChat(true);

  // 🔴 Phase 4b #4: 焦点 Agent 的真实 session 上抛 App → 侧栏会话列表高亮跟随 focusedAgent
  // （宫格模式下 sess.sessionId 是进宫格前的单视图全局 session，与焦点 Agent 不一致）
  const focusedSessionId = states[currentProfile]?.sessionId ?? null;
  useEffect(() => {
    onFocusedSessionChange?.(focusedSessionId);
  }, [focusedSessionId, onFocusedSessionChange]);

  // 🔴 新建会话：per-agent 状态槽归零 + 全局副作用（复用单视图 handleNewSession 同一套工具链）
  // 🔴 2026-08-11 对齐 Hermes openNewSessionTile：卡片新建 = 立即创建后端会话
  // （Hermes tile 新建立即 session.create + stored_session_id；原实现纯前端重置懒创建）
  const handleGridNewSession = useCallback(async (profile: string) => {
    resetAgent(profile);
    onNewSessionEffects?.(profile);
    try {
      const created = await getWsClient().sessionCreate({ profile });
      const sid = created.session_id;
      if (sid && sessionIdMatchesProfile(sid, profile)) {
        // 与 switchToSession 同款三行（函数定义在前，避免 TDZ 引用）
        loadLatest(profile, sid);
        persistSessionPointer(sid);
        onFocusChange?.(profile);
      }
    } catch {
      // 离线降级：保持空态，懒创建兜底（首条消息发送时自动建）
    }
  }, [resetAgent, onNewSessionEffects, loadLatest, onFocusChange]);

  // 🔴 M-1/M-2 修复：宫格发送不再注入全局 currentModel —— 每张卡片用自己
  // session 的 client（该 profile config.model_ref 热更新 + 卡片级 provider.switch override），
  // 各 Agent 模型互不干扰。useModelContext 仅保留给 ModelPill 展示。
  const handleSendTo = useCallback((profile: string, text: string, attachments?: Array<{ id: string; name: string; size: number; preview: string }>, attachmentDataURLs?: string[], sessionId?: string) => {
    sendTo(profile, text, undefined, { attachments, attachmentDataURLs, explicitSessionId: sessionId });
  }, [sendTo]);

  // 状态镜像（退出/展开时读当前各 Agent session 指针）
  const statesRef = useRef(states);
  statesRef.current = states;

  const containerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const projectedOrderRef = useRef<string[]>([]);   // 拖拽期间的逻辑顺序
  const justDraggedRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const colorMapRef = useRef(colorMap);
  colorMapRef.current = colorMap;

  const layout = computeLayout(order.length, width, height);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const registerRef = useCallback((name: string, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(name, el);
    else cellRefs.current.delete(name);
  }, []);

  // 监听容器宽高（列数随宽度 auto-fill，高度随窗口自适应）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
      setHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 拉取 Agent 列表（挂载时一次 + 编辑面板热更新时刷新） ──
  // 🔴 P1 修复：依赖从 [currentProfile] 改 []，消灭“点卡片切焦点 → 重拉列表 → setOrder 重置拖拽排序”
  // 🔴 2026-08-02 热更新修复：抽成可复用 refreshProfiles，编辑面板保存后调用（不再依赖重启）
  const refreshProfiles = useCallback(async () => {
    try {
      const data = await fetchProfiles();
      const list = data.profiles as ProfileInfo[];
      setProfiles(list);
      // 🔴 保留已有拖拽排序：仅初始化时赋值，后续只增删不重排
      setOrder((prev) => {
        if (prev.length === 0) return list.map((p) => p.name);
        const names = new Set(list.map((p) => p.name));
        const kept = prev.filter((n) => names.has(n));
        const added = list.map((p) => p.name).filter((n) => !prev.includes(n));
        return [...kept, ...added];
      });
      // 🔴 颜色权威源 = 后端 profile.color（#RRGGBB）；未设置时回退按序索引色
      const map: Record<string, string> = {};
      list.forEach((p, i) => { map[p.name] = p.color || AGENT_COLORS[i % AGENT_COLORS.length].dot; });
      setColorMap(map);
    } catch { /* 静默：下次刷新/重启自愈 */ }
  }, []);

  // 挂载时拉一次（mountedRef 防卸载后 setState）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    void refreshProfiles();
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 进入宫格：为每个有历史 session 的 profile 加载最新 N 条（后端权威源） ──
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current || profiles.length === 0) return;
    loadedRef.current = true;
    const map = loadProfilePointers();
    for (const p of profiles) {
      // 当前 profile 优先用 App 实时 sessionId（map 可能未及更新），其余用 per-profile 指针
      const sid = map[p.name] || (p.name === currentProfile ? currentSessionId : null);
      // 🔴 串台防御：map 指针可能被污染（指向其他 profile 的 session），校验后才加载
      if (sid && sessionIdMatchesProfile(sid, p.name)) loadLatest(p.name, sid);
    }
  }, [profiles, loadLatest, currentProfile, currentSessionId]);

  // ── 把各 Agent 当前 session 指针写回 localStorage（退出/展开前调用） ──
  const persistPointers = useCallback(() => {
    const entries: Record<string, string> = {};
    for (const [p, s] of Object.entries(statesRef.current)) {
      if (s?.sessionId) entries[p] = s.sessionId;
    }
    batchSaveProfilePointers(entries);
  }, []);

  // 🔴 宫格内切换某 Agent 卡片的会话（修复 BUG2：留宫格，不强行切单视图）
  // 串台防御：校验 sessionId 归属后才加载；聚焦归属 Agent（侧栏高亮跟随）
  const switchToSession = useCallback((profile: string, sessionId: string) => {
    if (!sessionIdMatchesProfile(sessionId, profile)) return;
    loadLatest(profile, sessionId);
    persistSessionPointer(sessionId);
    onFocusChange?.(profile);
  }, [loadLatest, onFocusChange]);

  // 🔴 命令式句柄：App 经 gridRef 调度宫格（switchToSession / persistPointers / newSession）
  useImperativeHandle(ref, () => ({ switchToSession, persistPointers, newSession: handleGridNewSession, execCommand, refreshProfiles }), [switchToSession, persistPointers, handleGridNewSession, execCommand, refreshProfiles]);

  // 🔴 退出/展开：持久化权威收敛到 App（handleExitGrid/handleExpandAgent 经 gridRef.persistPointers）。
  // 此处只回调 App，不再本地 persist，消灭“按钮退出持久化 / Ctrl+G 退出不持久化”的双路径不一致。
  const handleExit = useCallback(() => {
    onExitGrid();
  }, [onExitGrid]);

  const handleExpand = useCallback((profile: string) => {
    onExpandAgent(profile);
  }, [onExpandAgent]);

  // ── 把一张卡定位到它的槽位（命令式，带过渡） ──
  const setCardSlot = useCallback((name: string, index: number, animate: boolean) => {
    const el = cellRefs.current.get(name);
    if (!el) return;
    const { cols, cellW, cellH } = layoutRef.current;
    const pos = slotPos(index, cols, cellW, cellH);
    el.style.transition = animate ? SWAP_EASE : 'none';
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }, []);

  // order / 宽度变化时把所有卡归位（被拖的卡跳过）
  // useLayoutEffect：绘制前归位，避免初始加载时卡片先堆在左上角闪一帧
  useLayoutEffect(() => {
    order.forEach((name, idx) => {
      if (dragRef.current?.active && dragRef.current.name === name) return;
      setCardSlot(name, idx, true);
    });
  }, [order, width, height, setCardSlot]);

  // ── 指针拖拽（标题栏整条可拖 · window 级监听 + 指针捕获，最稳）──
  // 拖拽期间零 React 渲染：被拖卡直接写 DOM transform 跟手；换位只更新逻辑顺序
  // projectedOrder，其余卡 CSS transition 平滑滑过；松手提交 order，被拖卡弹性归位。

  const onWindowMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const container = containerRef.current;
    if (!container) return;

    // 4px 阈值：区分点击和拖拽
    if (!d.active) {
      if (Math.abs(e.clientX - d.downX) < 4 && Math.abs(e.clientY - d.downY) < 4) return;
      d.active = true;
      d.el.style.setProperty('--drag-ring', d.ring);
      d.el.classList.add('grid-cell-dragging');
      d.el.style.transition = 'none';   // 被拖卡不做过渡，直接跟手
      d.el.style.zIndex = '20';
    }

    const cRect = container.getBoundingClientRect();

    // 边缘自动滚动（多行网格可拖到当前不可见区域）
    const cursorViewY = e.clientY - cRect.top;
    if (cursorViewY < AUTO_SCROLL_EDGE) container.scrollTop -= AUTO_SCROLL_STEP;
    else if (cursorViewY > cRect.height - AUTO_SCROLL_EDGE) container.scrollTop += AUTO_SCROLL_STEP;

    // 光标的内容坐标（含滚动偏移）
    const contentX = e.clientX - cRect.left;
    const contentY = e.clientY - cRect.top + container.scrollTop;

    // 被拖卡位置 = 光标位置（唯一真值源）→ 永不漂移
    const tx = contentX - d.grabOffsetX;
    const ty = contentY - d.grabOffsetY;
    d.el.style.transform = `translate(${tx}px, ${ty}px) scale(1.03)`;

    // 换位检测：光标落在哪个槽位
    const { cols, rows, cellW, cellH } = layoutRef.current;
    const relX = contentX - PAD;
    const relY = contentY - PAD;
    const col = clamp(Math.floor(relX / (cellW + GAP)), 0, cols - 1);
    const row = clamp(Math.floor(relY / (cellH + GAP)), 0, rows - 1);
    const to = row * cols + col;

    const proj = projectedOrderRef.current;
    if (to >= proj.length) return;
    const from = proj.indexOf(d.name);
    if (to === from || proj[to] === d.name) return;

    // 只更新逻辑顺序（不动 DOM 顺序），其余卡平滑滑到新槽位
    [proj[from], proj[to]] = [proj[to], proj[from]];
    proj.forEach((nm, idx) => {
      if (nm !== d.name) setCardSlot(nm, idx, true);
    });
  }, [setCardSlot]);

  const onWindowUp = useCallback(() => {
    const d = dragRef.current;
    if (d && d.active) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 60);
      // 提交逻辑顺序 → effect 会把被拖卡弹性滑回槽位
      setOrder([...projectedOrderRef.current]);
      const el = d.el;
      el.style.zIndex = '';
      // 回弹动画期间保留“抬起”样式，落定后再移除（有“放下”的感觉）
      setTimeout(() => {
        el.classList.remove('grid-cell-dragging');
        el.style.transition = '';
      }, 400);
    }
    dragRef.current = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
  }, [onWindowMove]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;   // 排除按钮（展开等），按钮点击不触发拖拽
    const handle = target.closest('[data-drag-handle]');
    if (!handle) return;
    const card = handle.closest('[data-agent-name]') as HTMLDivElement | null;
    if (!card) return;
    const name = card.dataset.agentName;
    if (!name) return;

    // 指针捕获：拖出元素/窗口也不丢事件（window 监听兑底）
    try { (handle as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const rect = card.getBoundingClientRect();
    const dot = colorMapRef.current[name] ?? AGENT_COLORS[0].dot;

    dragRef.current = {
      name,
      el: card,
      downX: e.clientX,
      downY: e.clientY,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      active: false,
      // colorMap 存 dot 值（#RRGGBB 或 var(--ui-*)），统一经 cardColorFromHex 派生 ring
      ring: cardColorFromHex(dot).ring,
    };
    projectedOrderRef.current = [...orderRef.current];

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
  }, [onWindowMove, onWindowUp]);

  // 卸载时清理可能残留的 window 监听
  useEffect(() => () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
  }, [onWindowMove, onWindowUp]);

  const orderedProfiles = order
    .map((name) => profiles.find((p) => p.name === name))
    .filter((p): p is ProfileInfo => !!p);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 顶部控制条 ── */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/30"
        title="双击空白处返回单视图"
        onDoubleClick={handleExit}
      >
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors"
          title="返回单视图 (Ctrl+G)"
          onClick={handleExit}
        >
          <Square size={13} strokeWidth={1.5} />
          <span>单视图</span>
        </button>
        <span className="text-[11px] text-muted-foreground/50">
          {orderedProfiles.length} 个 Agent
        </span>
        <span className="text-[10px] text-muted-foreground/30 ml-auto">
          拖拽标题栏换位 · 点击卡片聚焦 · 双击空白处/展开按钮切单视图
        </span>
      </div>

      {/* ── 宫格区域（绝对定位 + transform，内容撑高可滚动，事件委托）── */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-y-auto"
        onPointerDown={handlePointerDown}
      >
        {width > 0 && height > 0 && (
          <div style={{ height: layout.contentH, position: 'relative' }}>
            {orderedProfiles.map((profile) => (
              <div
                key={profile.name}
                ref={(el) => registerRef(profile.name, el)}
                data-agent-name={profile.name}
                onClick={() => { if (!justDraggedRef.current) onFocusChange?.(profile.name); }}
                className="absolute top-0 left-0"
                style={{ width: layout.cellW, height: layout.cellH }}
              >
                <AgentChatCard
                  profile={profile}
                  state={states[profile.name] ?? EMPTY_AGENT_STATE}
                  color={cardColorFromHex(colorMap[profile.name] ?? AGENT_COLORS[0].dot)}
                  focused={currentProfile === profile.name}
                  portReady={portReady}
                  onSend={handleSendTo}
                  onLoadMore={loadMore}
                  onAbort={abortAgent}
                  onClearPending={clearPending}
                  onExpand={handleExpand}
                  onNewSession={handleGridNewSession}
                  onCommand={execCommand}
                  onSlashConfirmDone={handleSlashConfirmDone}
                  onQueueSendNow={sendQueueNow}
                  onQueueDelete={deleteQueueEntry}
                  onSelectModel={onSelectModel}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 宫格 Artifact 浮层预览（无右栏语义，portal 到 body） */}
      <ArtifactPreviewOverlay />
    </div>
  );
});

export default GridModeView;
