import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMessageCount, setMessages as storeSetMessages, getIsStreaming } from './store/messages';
import {
  addDebugEvent,
  setDebugToolCalls,
  setMonitor,
  useMonitorModelName,
  useMonitorSessionStartedAt,
} from './store/debug';
import { textPart } from '@/lib/chat-messages';
import { requestComposerInsert } from '@/lib/composer-events';
import { setCurrentSessionCwd } from '@/lib/session-cwd';
import { useSessions } from './hooks/useSessions';
import { useBootstrap } from './hooks/useBootstrap';
import { usePanelLayout } from './hooks/usePanelLayout';
import { useGatewayHealth } from './hooks/useGatewayHealth';
import { useMessageStream } from './hooks/useMessageStream';
import { usePromptActions } from './hooks/usePromptActions';
import { useImageAttachments } from './hooks/useImageAttachments';
import { useFileAttachments } from './hooks/useFileAttachments';
import { dragHasPaths, collectDroppedPaths } from '@/lib/paths-dnd';
import { useSessionActions } from './hooks/useSessionActions';
import { setActiveSessionOverride } from './store/session-status';
import { onWakeDetected } from './lib/wake-events';
import useModels from './hooks/useModels';
import * as storage from './utils/storage';
import { call, isDesktop, discoverPort, getHttpBase } from './utils/bridge';
import { loadConnection, isRemoteMode } from './lib/connection';
import { getRememberedWorkspaceCwd, rememberWorkspaceCwd } from './lib/workspace-cwd';
import { getActiveProfile } from './utils/api';
import { getWsClient, setWsActiveProfile, type SessionCreateResponse } from './services/ws-client';
import { sessionIdMatchesProfile, profileFromSessionId, persistSessionPointer, clearSessionPointer, loadProfilePointers, saveProfilePointer, removeProfilePointer } from './utils/session';
import { notifyError, notifyInfo } from './utils/notifications';
import type { ChatMessage } from './types';
import { Minus, Square, X, FileText } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import CredentialCard from './components/CredentialCard';
import { ThemeProvider } from './themes/index';
import IconBar from './components/IconBar';
import SidePanel from './components/SidePanel';
import OverlayView from './components/OverlayView';
import { useOpenArtifact } from './store/artifacts';
import ThemePanel from './components/ThemePanel';
import SettingsPanel from './components/SettingsPanel';
import AboutPanel from './components/AboutPanel';
import ModelPickerPanel from './components/ModelPickerPanel';
import ToolStatusBar from './components/ToolStatusBar'
import MessageContainer from './components/MessageContainer';
import InputArea from './components/InputArea';
import ContextBar from './components/ContextBar';
import TodoPanel from './components/TodoPanel';
import ClarifyCard from './components/ClarifyCard';
import ClarifyBatchCard from './components/ClarifyBatchCard';
import ApprovalCard from './components/ApprovalCard';
import SlashConfirmCard from './components/SlashConfirmCard';
import AppShell from './components/AppShell';
import PaneShell, { Pane, PaneMain, PaneCollapseBtn } from './components/PaneShell';
import FileBrowserPanel from './components/FileBrowserPanel';
import TerminalPanel from './components/TerminalPanel';
import PreviewCenter from './components/preview/PreviewCenter';
import ImageLightbox from './components/ImageLightbox';
import ImageEditorModal from './components/ImageEditorModal';
import { ImageEditorContext, type ImageEditorTarget, type ImageEditorApi } from './store/image-editor';
import { initPreviewEvents } from '@/lib/preview-events';
import { usePaneOpenRequest, getPreviewStoreState, closeTab as closePreviewTab } from '@/store/preview';
import ArtifactPanel from './components/ArtifactPanel';
import RightSidebarTabs from './components/RightSidebarTabs';
import CommandCenter from './components/CommandCenter';
import Toast from './components/Toast';
import GridModeView, { type GridModeViewHandle } from './components/GridModeView';
import EditAgentDialog from './components/EditAgentDialog';
import { ModelProvider } from './contexts/ModelContext';
import { toggleDeepSeek, hideDeepSeek } from './utils/deepseek-webview';
import type { Window } from '@tauri-apps/api/window';

// ── Tauri window API (lazy) ──
let tauriWindow: Window | null = null;
(async () => {
  try {
    const m = await import('@tauri-apps/api/window');
    tauriWindow = m.getCurrentWindow();
  } catch { /* browser dev mode */ }
})();

// ── helpers ──

// 🔴 2026-08-12 联动重构（老大需求：选 Agent → 点项目/HOME → 消息区 + 右侧文件联动）：
//   找某 Agent 某域的最新活跃会话：
//   - 项目域（path 非空）= 会话 cwd 在 path 下（前缀匹配 + 路径边界，防 C:\projAB 误判属于 C:\projA）
//   - HOME 域 = 该 Agent workspace 路径（后端注入 Home 桶 path；匹配 workspace 下会话）
//   按 last_active 降序取最新；无匹配返回 null
/** 🔴 2026-08-17 阶段4：会话短标签（后台会话交互卡片显示） */
function shortSessionLabel(sid: string): string {
  return sid.length > 16 ? `${sid.slice(0, 8)}…${sid.slice(-6)}` : sid
}

function latestSessionForDomain(
  sessions: Array<{ id: string; cwd?: string | null; last_active: number }>,
  profile: string,
  path: string,
): { id: string; cwd?: string | null; last_active: number } | null {
  const p = path.toLowerCase(); // Windows 路径大小写不敏感
  const matches = sessions.filter((s) => {
    if (!sessionIdMatchesProfile(s.id, profile)) return false;
    const c = (s.cwd ?? '').toLowerCase();
    if (path) return !!c && (c === p || c.startsWith(p + '\\') || c.startsWith(p + '/'));
    return !c;
  });
  return matches.sort((a, b) => b.last_active - a.last_active)[0] ?? null;
}

// 🔴 2026-08-18 画布 × ELEVE 集成 + 2026-08-19 根治修订：
// 画布 = ELEVE 的可拔插插件（浏览器半，由 gateway 同源装载）。
// 启动解析全部在后端统一完成（WS RPC canvas.open → rpc_canvas::canvas_open_intent
// 意图语义：已连则幂等；未连则推 shell.open_canvas 帧给壳开窗并立即返回）。
// 就绪以 canvas.ready 事件（壳 toast「画布已连接 ELEVE」）与 canvas_query 为准。

export default function App() {
  // 🔴 2026-08-13 Phase 2 拆分：三栏布局状态抽离到 usePanelLayout（纯移动，无逻辑变更）
  const {
    activePanel, setActivePanel,
    panelWidth, setPanelWidth,
    responsiveCollapsed,
    rightOpen, setRightOpen,
    rightAnchor, setRightAnchor,
    rightTab, setRightTab,
    terminalMounted,
    previewMounted,
    handleToggleFiles,
    MIN_CHAT_WIDTH,
  } = usePanelLayout();

  // 🔴 Artifact 右栏化（对齐 Hermes openArtifact → 打开右栏 tab）：
  // 消息内卡片点击 openArtifact() 后，单视图自动打开右栏并切到「产物」tab；
  // 宫格模式无右栏语义 → 浮层由 GridModeView 内挂载承载。
  const messageCount = useMessageCount();
  const [commandCenterOpen, setCommandCenterOpen] = useState<boolean>(false);
  const [sessionListVersion, setSessionListVersion] = useState<number>(0);  // 刷新会话列表
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');  // 多 Agent 视图模式

  // 🔴 Artifact 右栏化（对齐 Hermes openArtifact → 打开右栏 tab）：
  // 消息内卡片点击 openArtifact() 后，单视图自动打开右栏并切到「产物」tab；
  // 宫格模式无右栏语义 → 浮层由 GridModeView 内挂载承载。
  const artifactOpen = useOpenArtifact();
  useEffect(() => {
    if (artifactOpen && viewMode === 'single') {
      setRightOpen(true);
      setRightTab('artifacts');
    }
  }, [artifactOpen, viewMode]);

  // 🔴 预览中心：外部事件（open_preview 工具 / #preview 链接 / 文件树双击）请求打开预览面板
  // 对齐 Hermes $revealInTreeRequest：事件源 → App 消费
  const paneOpenRequest = usePaneOpenRequest();
  useEffect(() => {
    if (paneOpenRequest > 0 && viewMode === 'single') {
      setRightOpen(true);
      setRightTab('preview');
    }
  }, [paneOpenRequest, viewMode]);
  // 🔴 Phase 4b #4: 宫格焦点 Agent 的实时 sessionId（GridModeView 上抛）→ 侧栏会话列表高亮跟随
  const [focusedGridSessionId, setFocusedGridSessionId] = useState<string | null>(null);
  // 🔴 2026-08-13 P2-2：宫格 unread 判定基准 = 焦点卡片会话（session-status override）。
  // 宫格焦点切换不写全局 session 指针（防污染单视图指针语义），故 unread 判定需独立基准；
  // 退出宫格 → override 清空 → 回退全局指针（单视图模式）。
  useEffect(() => {
    setActiveSessionOverride(viewMode === 'grid' ? focusedGridSessionId : null);
  }, [viewMode, focusedGridSessionId]);
  const [deepseekVisible, setDeepseekVisible] = useState<boolean>(false);  // DeepSeek 嵌入 WebView 显隐
  const chatCardRef = useRef<HTMLDivElement>(null);  // DeepSeek WebView 锚点

  // 🔴 2026-08-18 画布 × ELEVE 集成 + 2026-08-19 根治修订 + toggle 改造：
  // 画布 = ELEVE 的可拔插插件（浏览器半，由 gateway 同源装载）。
  // 按钮 = **切换语义**（2026-08-19 需求：再点收起，不无限新开）：WS RPC
  // canvas.toggle → rpc_canvas::canvas_toggle_intent —— 画布已连 → 推
  // shell.toggle_canvas 帧给壳（可见→隐藏 / 隐藏→显示，不新开窗口）；未连
  // → 推 shell.open_canvas 帧开窗。单例硬约束在壳（canvas 唯一 label），
  // agent 工具 canvas_open 走 canvas.open 幂等（已连 → already_open），
  // 任何路径都不可能开第二个窗口。
  const handleOpenCanvas = useCallback(async () => {
    try {
      const result = await call('canvas_toggle', {});
      const status = (result as { status?: string } | null)?.status;
      if (status === 'toggled') {
        notifyInfo('画布窗口已切换');
      } else if (status === 'opening') {
        notifyInfo('已发出打开画布指令，窗口即将弹出');
      } else {
        notifyInfo('画布指令已发出');
      }
    } catch (e) {
      notifyError(e, '操作画布窗口失败');
    }
  }, []);
  // 🔴 2026-08-17 阶段4（per-session 并发轮配套）：交互状态从单槽改为
  // **按会话多槽**（Record<sessionId, interaction>）——后台会话的审批/
  // 澄清/凭据请求必须可见可响应（单槽覆盖 = 前一个会话的工具挂到超时）。
  // 当前会话的交互渲染在消息区原位置；其他会话的交互渲染"后台会话交互"区。
  type PendingInteraction =
    | { kind: 'approval'; sessionId: string; data: { command: string; description: string; pattern: string; choices: string[]; run_id: string } }
    | { kind: 'clarify'; sessionId: string; data: { clarify_id: string; question: string; choices: string[]; multi_select?: boolean } }
    // 🔴 批量澄清（一次表单多题，对齐 Hermes questions batch）
    | { kind: 'clarify_batch'; sessionId: string; data: { clarify_id?: string; title?: string | null; questions?: { qid: string; id?: string | null; question: string; choices?: string[] | null; multi_select?: boolean }[] } }
    | { kind: 'sudo'; sessionId: string; data: { request_id: string; prompt?: string } }
    | { kind: 'secret'; sessionId: string; data: { request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } };
  const [pendingInteractions, setPendingInteractions] = useState<Record<string, PendingInteraction>>({});
  const upsertInteraction = useCallback((it: PendingInteraction) => {
    setPendingInteractions((prev) => ({ ...prev, [it.sessionId]: it }));
  }, []);
  const removeInteraction = useCallback((sessionId: string) => {
    setPendingInteractions((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);
  const [activeSlashConfirm, setActiveSlashConfirm] = useState<{ confirmId: string; command: string; description: string } | null>(null);

  // ── overlay panel state (settings, about) ──
  const [overlayPanel, setOverlayPanel] = useState<string | null>(null);
  const handleOpenOverlay = useCallback((panelName: string) => {
    // 打开弹出卡片时隐藏 DeepSeek WebView，避免被盖住
    hideDeepSeek().then(() => setDeepseekVisible(false));
    setOverlayPanel(panelName);
  }, []);
  const handleCloseOverlay = useCallback(() => setOverlayPanel(null), []);
  const handleOpenSettings = useCallback(() => handleOpenOverlay('settings'), [handleOpenOverlay]);

  // 🔴 宫格按钮修复：运行期建/删 Agent 由 ProfilePanel 回调驱动（消灭一次性快照平行源）。
  // （agentCount state 与启动拉取在 useBootstrap——2026-08-13 Phase 2 拆分）
  const handleProfilesChange = useCallback((count: number) => setAgentCount(count), []);

  // 🔴 2026-08-13 Phase 2 拆分：currentProfileLabel 移到 useBootstrap 解构后计算。

  // ── 多 Agent UI：Ctrl+G 切换单视图/宫格 ──
  // 🔴 P1-3: grid→single 必须走 handleExitGrid（persistPointers + restoreProfileSession）
  const exitGridRef = useRef<() => void>(() => {});
  const toggleViewMode = useCallback(() => {
    if (viewMode === 'single') {
      hideDeepSeek().then(() => setDeepseekVisible(false));
      // 🔴 P0 修复：进宫格前重置单视图发送锁（宫格期间 useSSE 禁用 → 单视图 onDone 永不触发 → 锁泄漏）
      resetSendingLockRef.current?.();
      setViewMode('grid');
    } else {
      exitGridRef.current();
    }
  }, [viewMode]);

  // ── DeepSeek 嵌入 toggle ──
  const handleToggleDeepSeek = useCallback(async () => {
    const anchor = chatCardRef.current;
    console.log('[DeepSeek] toggle clicked, anchor:', anchor ? 'found' : 'NULL');
    if (!anchor) return;
    const nowVisible = await toggleDeepSeek(anchor);
    console.log('[DeepSeek] result:', nowVisible);
    setDeepseekVisible(nowVisible);
  }, []);

  // ── DeepSeek 内嵌关闭按钮 → 统一走 hideDeepSeek（单一状态权威，防双入口状态错乱）──
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      listen('deepseek-embed-closed', () => {
        hideDeepSeek().then(() => setDeepseekVisible(false));
      }).then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        toggleViewMode();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleViewMode]);

  // ── 面板切换时自动隐藏 DeepSeek WebView ──
  useEffect(() => {
    if (deepseekVisible) {
      hideDeepSeek().then(() => setDeepseekVisible(false));
    }
  }, [activePanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── session management（必须在 handleProfileChange 之前，切换 Agent 需要重置 session） ──
  const sess = useSessions();
  // 🔴 2026-08-17 阶段4：当前会话交互（渲染原位置）+ 后台会话交互（独立区）
  const currentSid = sess.sessionId ?? '';
  const currentInteraction = currentSid ? pendingInteractions[currentSid] : undefined;
  const currentClarify = currentInteraction?.kind === 'clarify' ? currentInteraction.data : null;
  const currentClarifySessionId = currentInteraction?.kind === 'clarify' ? currentInteraction.sessionId : '';
  // 🔴 批量澄清（一次表单多题，对齐 Hermes questions batch）
  const currentClarifyBatch = currentInteraction?.kind === 'clarify_batch' ? currentInteraction.data : null;
  const currentClarifyBatchSessionId = currentInteraction?.kind === 'clarify_batch' ? currentInteraction.sessionId : '';
  const currentApproval = currentInteraction?.kind === 'approval' ? currentInteraction.data : null;
  const currentApprovalSessionId = currentInteraction?.kind === 'approval' ? currentInteraction.sessionId : '';
  const currentSudo = currentInteraction?.kind === 'sudo' ? currentInteraction.data : null;
  const currentSudoSessionId = currentInteraction?.kind === 'sudo' ? currentInteraction.sessionId : '';
  const currentSecret = currentInteraction?.kind === 'secret' ? currentInteraction.data : null;
  const currentSecretSessionId = currentInteraction?.kind === 'secret' ? currentInteraction.sessionId : '';
  const backgroundInteractions = Object.entries(pendingInteractions)
    .filter(([sid]) => sid !== currentSid)
    .map(([sid, it]) => ({ sid, it }));

  // 🔴 2026-08-13 Phase 2 拆分：启动编排（port/storage/profile/deps 门控）抽离到 useBootstrap。
  const {
    connectionStatus,
    setConnectionStatus,
    depsReady,
    portReady,
    storageReady,
    profileResolved,
    currentProfile,
    setCurrentProfile,
    agentCount,
    setAgentCount,
    displayNames,
    setDisplayNames,
    agentColors,
    setAgentColors,
    agentAvatarKeys,
    setAgentAvatarKeys,
    profileRefreshSignal,
    bumpProfileRefresh,
    editTarget,
    setEditTarget,
    profileDegradedRef,
  } = useBootstrap({ sess });
  // 🔴 昵称全局生效：状态栏/会话列表显示昵称而非英文 ID（display_name 唯一持有者 = ProfilePanel，App 不重复拉取）。
  const currentProfileLabel = displayNames[currentProfile] || currentProfile;

  // 🔴 W-7: 会话 cwd（session.info 推送）— 传预览中心供重启预览使用
  // 会话切换时清空，等新会话的 session.info 重新推送
  const [sessionCwd, setSessionCwd] = useState('');
  // 🔴 2026-08-13 老大语义定稿：三个独立功能 + 单向联动。
  // panelRoot = 右侧文件面板的重定向根（真实文件树的显示位置）：
  //   ① 点选项目卡片（含 HOME）→ 单向重定向到该项目绑定的物理地址（项目虚拟、
  //      per-profile 绑定物理路径，终身不变——面板操作永不反向影响项目）
  //   ② 面板内导航/操作 = 真实文件导航（可编辑/删除/重命名），只作用于文件系统
  //   ③ 会话切换/新建/session.info → 不重定向面板（面板不跟随会话）
  //   ④ 切 Agent → 重置（该 Agent 激活项目恢复时重定向）
  const [panelRoot, setPanelRoot] = useState<string | null>(null);
  // 🔴 2026-08-13 边界修复：无会话手动导航 → 新会话落点暂存（对齐 Hermes $newChatWorkspaceTarget）。
  // 文件面板无会话时导航目录 → 新会话落该目录（此前只做了 remote 记忆，本会话不消费 = 断线）；
  // 任何项目域动作（点项目/会话行/切 Agent）→ 清除（项目意图覆盖手动导航）。
  const newChatWorkspaceTargetRef = useRef<string | null>(null);
  useEffect(() => {
    // 🔴 2026-08-13 老大语义重构：会话切换只影响 sessionCwd（终端/新会话落点），
    // 不碰 panelRoot（文件面板是项目映射视图，不跟随会话）。
    setSessionCwd('');
  }, [sess.sessionId]);

  // 🔴 2026-08-09 启动 seed（对齐 Hermes ensureDefaultWorkspaceCwd + $currentCwd
  // 初始值 = getRememberedWorkspaceCwd）：无会话时把工作目录 seed 到当前 cwd——
  //   remote → 上次工作目录记忆（per baseUrl+profile）
  //   local → 不 seed（🔴 2026-08-13 老大指示：默认工作目录设置已取消——
  //     启动后由用户点选项目/HOME 单向重定向面板；新会话落点由项目 scope 决定）
  // 对齐 Hermes seedLiveCwd：文件面板/终端/预览显示该目录；无会话新聊天
  // （getNewSessionCwd 链）继承它 = 新会话落默认目录（Hermes 新会话继承 currentCwd）。
  // 目录不存在时 FileBrowserPanel setRoot 失败 → error → fallback（默认目录→home）
  // 自洽；会话切换后 session.info 覆盖。profile 变化不重跑（Hermes $currentCwd
  // 亦非 per-profile——会话 cwd 由 session.info 管）。
  useEffect(() => {
    let cancelled = false;
    const trySeed = (): boolean => {
      if (cancelled) return true;
      const conn = loadConnection();
      if (isRemoteMode(conn) && conn.baseUrl) {
        const r = getRememberedWorkspaceCwd({ baseUrl: conn.baseUrl, profile: currentProfile });
        if (r) {
          seededCwdRef.current = r;
          setSessionCwd(r);
          setPanelRoot(r); // 🔴 2026-08-13 老大语义重构：初始面板映射 = seed 目录
        }
        return true; // remote：记忆有无都算完成
      }
      return true; // local：不 seed（默认工作目录设置已取消）
    };
    if (!trySeed()) {
      const t = setInterval(() => {
        if (trySeed()) clearInterval(t);
      }, 500);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔴 2026-08-09 项目 scope（对齐 Hermes $projectScope / workspaceTarget）：
  // 进入项目钻取时设置（新会话落点 = 项目根目录），退出钻取清除。
  // Hermes 同款：scope 只决定"新聊天落在哪"，不改文件面板 cwd（那是
  // syncProjectCwd/session.info 的职责）。ref 镜像供 usePromptActions 稳定读取。
  const [projectScopeCwd, setProjectScopeCwd] = useState<string | null>(null);
  const projectScopeCwdRef = useRef<string | null>(null);
  projectScopeCwdRef.current = projectScopeCwd;
  // 🔴 2026-08-09 启动 seed 值快照（ref 持久）：[sess.sessionId] effect 会把
  // sessionCwd 清空（会话切换/新建），seed 的默认目录不能丢——getNewSessionCwd
  // 用它兜底（无会话新聊天仍落默认目录，Hermes resolveNewSessionCwd 继承语义）
  const seededCwdRef = useRef<string | null>(null);

  // 🔴 Remote 记忆（对齐 Hermes setCurrentCwd → persistString workspaceCwdKey）：
  // remote 模式下会话 cwd 变化 → 按 baseUrl+profile 记忆，未显式指定目录的
  // 新会话复用（handleSend/AgentCard 建会话时消费）
  useEffect(() => {
    if (!sessionCwd) return;
    const conn = loadConnection();
    if (isRemoteMode(conn) && conn.baseUrl) {
      rememberWorkspaceCwd({ baseUrl: conn.baseUrl, profile: currentProfile }, sessionCwd);
    }
  }, [sessionCwd, currentProfile]);

  // 🔴 预览域 WS 事件路由（对齐 Hermes use-preview-routing）：
  // preview.restart.progress/complete / preview.open / tool.complete+inline_diff 自动刷新
  // 挂载 App 生命周期（全局单点），卸载清理。
  // ⚠️ 闭包陷阱：空依赖 useEffect 捕获首次渲染值 → 用 ref 持有最新会话 id
  const focusedSessionIdRef = useRef(sess.sessionId);
  focusedSessionIdRef.current = sess.sessionId;
  // 🔴 2026-08-28 对齐 Hermes $currentCwd：会话 cwd 写入全局单例（lib/session-cwd.ts），
  //   供深层组件同步读取——markdown #preview 链接相对路径归一化（StreamBlocks/
  //   ToolEntry/AgentCardComposer/PreviewCenter）与 preview-events 共用同一真相源
  //   （原 sessionCwdRef 闭包双轨已删）
  useEffect(() => {
    setCurrentSessionCwd(sessionCwd || null);
  }, [sessionCwd]);

  // 🔴 2026-08-09 对齐 Hermes use-cwd-actions：文件面板切换目录 → 后端烙印持久化。
  //   有会话：session.cwd.set（后端烙印 + emit session.info → useMessageStream
  //   setSessionCwd 闭环，Hermes session.cwd.set 同款）；busy 时后端拒绝（catch 忽略，
  //   Hermes 同：session busy 4009）。无会话（新聊天未创建）：暂存为新会话目标
  //   （Hermes $newChatWorkspaceTarget 语义）——remote 模式由上方 effect 自动
  //   rememberWorkspaceCwd，后续 session.create 消费（App L859）
  // 🔴 2026-08-13 边界修复：新会话落点单一漏斗（手动导航 target > 项目 scope > 启动 seed）。
  // 统一消费点：handleNewSessionWithScope / gridAwareNewSession / 宫格 /new / handleSend 懒创建 /
  // usePromptActions sessionCreate——禁止各处独立拼接（此前 4 处平行实现易漏 target）。
  const resolveNewSessionCwd = useCallback((): string | null => {
    const target = newChatWorkspaceTargetRef.current?.trim();
    if (target) return target;
    const scope = projectScopeCwdRef.current;
    if (scope) return scope;
    const seeded = seededCwdRef.current?.trim();
    return seeded || null;
  }, []);

  const handleFilePanelCwdChange = useCallback((path: string) => {
    // 🔴 2026-08-13 老大语义重构：手动导航只改面板显示（映射视图）——
    // setPanelRoot(path)；项目地址本身后端权威、永不被改。
    // 🔴 2026-08-16 冻结语义（DSH 对齐）：不再 session.cwd.set 烙印——
    // 会话工作目录创建即冻结，手动导航是纯视图操作（原 busy pending /
    // 轮末补偿机制随之退役）。
    setPanelRoot(path);
    if (!sess.sessionId) {
      setSessionCwd(path);
      // 🔴 2026-08-13 边界修复：无会话导航 → 新会话落点暂存（resolveNewSessionCwd 消费）
      newChatWorkspaceTargetRef.current = path;
    }
  }, [sess.sessionId]);

  useEffect(() => {
    // 🔴 cwd 已走 lib/session-cwd.ts 全局单例（2026-08-28 对齐 $currentCwd），此处只留会话过滤
    return initPreviewEvents({
      getFocusedSessionId: () => focusedSessionIdRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔴 D1 修复：切换 profile 时刷新会话列表（session.list 后端按 params.profile 过滤）
  useEffect(() => {
    sess.refresh();
  }, [currentProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // 🔴 P2 修复：sessionListVersion 消费端接线（之前 10+ 生产端 increment 但零消费 → 侧栏不刷新）
  // session 创建/reset/标题更新等事件 increment version → 触发刷新
  useEffect(() => {
    if (sessionListVersion > 0) sess.refresh();
  }, [sessionListVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── model picker state ──
  const [showModelPicker, setShowModelPicker] = useState<boolean>(false);
  const handleOpenModelPicker = useCallback(() => setShowModelPicker(true), []);
  const handleCloseModelPicker = useCallback(() => setShowModelPicker(false), []);

  const nextId = useRef<number>(0);
  const genId = useCallback(() => `m${++nextId.current}`, []);

  // ── model discovery（依赖 sess.sessionId，必须在 sess 之后） ──
  const modelDiscovery = useModels({ enabled: portReady, sessionId: sess.sessionId ?? undefined, currentProfile });

  // 🔴 2026-08-12 修复：宫格选模型回调稳定引用 —— 原内联箭头每渲染新建 →
  // 击穿 AgentChatCard 的 memo（拖窗体 width/height 变化时所有卡片全量重渲染 → 卡崩）。
  // modelDiscovery.selectModel 本身是 useCallback（稳定），这里只做参数适配层。
  const handleGridSelectModel = useCallback((profile: string, modelId: string, sid?: string | null) => {
    modelDiscovery.selectModel(modelId, profile, sid ?? undefined);
  }, [modelDiscovery.selectModel]);

  // 🔴 打开模型选择器时自动 refresh（修复：启动重试窗口过期后池才有数据 → 永远空列表）
  useEffect(() => {
    if (showModelPicker) {
      modelDiscovery.refresh();
    }
  }, [showModelPicker]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── gateway health monitoring ──
  const gatewayHealth = useGatewayHealth({
    interval: 10000,
    enabled: portReady,
    onOnline: () => {
      if (connectionStatus === 'error') setConnectionStatus('idle');
      // 🔴 P1-5: 网关恢复后补拉 active profile（重试耗尽降级时 CLI 设的 active 桌面不跟随）
      if (profileDegradedRef.current) {
        getActiveProfile()
          .then((name) => { profileDegradedRef.current = false; setWsActiveProfile(name); setCurrentProfile(name); })
          .catch(() => {});
      }
    },
    onOffline: () => {
      // 网关离线 → 可能 eleved 重启换了端口，重新发现
      console.warn('[App] Gateway offline, re-discovering port...');
      discoverPort().then((ok) => {
        if (ok) {
          console.log('[App] Port re-discovered successfully');
        } else {
          console.error('[App] Port re-discovery failed');
        }
      });
    },
  });

  // ── debug / monitoring state（下沉到 store/debug.ts：App 根不再持有调试状态，
  //     DebugPanel/AppShell/ModelContext 自订阅，事件不再触发整树重渲染）──
  const modelName = useMonitorModelName();
  const sessionStartedAt = useMonitorSessionStartedAt();

  // ── drain queue ref (wired after usePromptActions) ──
  const drainQueueRef = useRef<any>(null);
  const resetSendingLockRef = useRef<(() => void) | null>(null);

  // 🔴 2026-08-13 问题1修复：session.info 的 cwd 覆盖在"项目钉住"期间被忽略
  // （点击项目进入 → 文件面板保持项目根；推荐会话 cwd=子目录/workspace 时不跳走）。
  // 兼容 Dispatch 签名（useMessageStream 只传 string；函数值直接透传）。
  // 🔴 2026-08-13 二轮：空 cwd + scope 存在 → 项目根兜底（会话无绑定时不显示
  // "未打开项目"——切 Agent 恢复 active 项目 / 点项目后会话无绑定的场景）。
  const handleSessionInfoCwd = useCallback((cwd: React.SetStateAction<string>) => {
    if (typeof cwd !== 'string') {
      setSessionCwd(cwd);
      return;
    }
    // 🔴 2026-08-13 老大语义重构：session.info 只更新 sessionCwd（终端/新会话落点），
    // 不碰 panelRoot（文件面板是项目映射视图，会话 cwd 不驱动它）。
    // 会话无绑定（bound_cwd 空）+ 有项目域 scope → 显示 scope 项目根（非空态）
    if (!cwd && projectScopeCwdRef.current) {
      setSessionCwd(projectScopeCwdRef.current);
      return;
    }
    setSessionCwd(cwd);
  }, []);

  // ── useMessageStream: SSE callbacks + throttle + useSSE ──
  const {
    isStreaming,
    send,
    abort,
    resetStream,
    currentSessionIdRef,
  } = useMessageStream({
    genId,
    addDebugEvent,
    setConnectionStatus,
    setDebugToolCalls,
    setMonitorState: setMonitor,
    // 🔴 2026-08-17 阶段4：交互事件带 session_id → 多槽 upsert；
    // null = 该会话 pending 快照为空（session.info 权威）→ 清该会话项
    setActiveClarify: (data) => {
      if (data === null) { if (sess.sessionId) removeInteraction(sess.sessionId); return; }
      upsertInteraction({ kind: 'clarify', sessionId: data.session_id ?? sess.sessionId ?? '', data: { clarify_id: data.clarify_id, question: data.question, choices: data.choices, multi_select: data.multi_select } });
    },
    // 🔴 批量澄清（一次表单多题，对齐 Hermes questions batch）
    setActiveClarifyBatch: (data) => {
      if (data === null) { if (sess.sessionId) removeInteraction(sess.sessionId); return; }
      upsertInteraction({ kind: 'clarify_batch', sessionId: data.session_id ?? sess.sessionId ?? '', data: { clarify_id: data.clarify_id, title: data.title ?? null, questions: data.questions ?? [] } });
    },
    setActiveApproval: (data) => {
      if (data === null) { if (sess.sessionId) removeInteraction(sess.sessionId); return; }
      const sid = data.session_id ?? data.run_id ?? sess.sessionId ?? '';
      upsertInteraction({ kind: 'approval', sessionId: sid, data: { command: data.command, description: data.description, pattern: data.pattern, choices: data.choices, run_id: data.run_id } });
    },
    setActiveSudo: (data) => {
      if (data === null) { if (sess.sessionId) removeInteraction(sess.sessionId); return; }
      upsertInteraction({ kind: 'sudo', sessionId: data.session_id ?? sess.sessionId ?? '', data: { request_id: data.request_id, prompt: data.prompt } });
    },
    setActiveSecret: (data) => {
      if (data === null) { if (sess.sessionId) removeInteraction(sess.sessionId); return; }
      upsertInteraction({ kind: 'secret', sessionId: data.session_id ?? sess.sessionId ?? '', data: { request_id: data.request_id, prompt: data.prompt, env_var: data.env_var, metadata: data.metadata } });
    },
    closeApproval: (sessionId) => removeInteraction(sessionId),
    setActiveSlashConfirm,
    setSessionCwd: handleSessionInfoCwd, // 🔴 2026-08-13 问题1：项目钉住期间忽略 session.info 覆盖
    sess,
    drainQueueRef,
    setSessionListVersion,
    enabled: viewMode === 'single',  // 🔴 宫格模式暂停 useSSE，useGridChat 接管 WS 事件
  });

  // ═══════════════════════════════════════════════════════════════════
  //  单视图会话装载 — 单一权威入口（消灭 startupRestored/handleProfileChange/restoreProfileSession 三重重复）
  // ═══════════════════════════════════════════════════════════════════
  //  🔴 BUG1 根因修复：过期响应守卫比 currentSessionIdRef（resetStream 同步锁定），
  //  不比异步 sess.sessionId（setState 异步 → .then() 时闭包值陈旧 → 误丢有效历史 → 首次切换丢消息）。
  //  调用前提：调用方必须先 resetStream(targetId) 同步锁定权威 ref。
  const loadSessionIntoView = useCallback((targetId: string) => {
    // 🔴 P1-3: 切换会话时清空交互卡片（防 A 的审批卡留在 B 视图）。
    // 2026-08-17 阶段4：多槽交互**按会话归属**——切会话只改变渲染目标，
    // 不清 interactions（后台会话的审批仍在后端等待，清了 = 工具超时；
    // 空快照由 session.info pending_prompts 权威清理）。只清 slashConfirm。
    setActiveSlashConfirm(null);
    sess.setSessionId(targetId);
    // 🔴 2026-08-22：切换/恢复会话 → 后端确认前不可发送（门禁）
    sess.setSessionReady(false);
    persistSessionPointer(targetId);
    sess.setFreshDraftReady(false);
    getWsClient().switchSession(targetId);
    // 缓存秒显（纯 UX 防白屏，始终被后端覆盖）
    const cached = sess.msgCache[targetId];
    storeSetMessages(cached?.length ? (cached as ChatMessage[]) : []);
    // 🔴 始终从后端加载完整历史（含离开期间的消息）
    sess.loadHistory(targetId).then((msgs) => {
      if (currentSessionIdRef.current !== targetId) return; // 🔴 过期响应守卫：同步权威 ref
      if (msgs?.length) {
        storeSetMessages(msgs as ChatMessage[]);
        sess.saveCache((c) => ({ ...c, [targetId]: msgs }));
      }
      // 🔴 2026-08-22 门禁释放：后端已确认该会话（加载完成）→ 会话就绪，
      // 恢复期间缓存命中（msgCache 已回填），发送/附件可安全进行
      sess.setSessionReady(true);
    });
  }, [sess, currentSessionIdRef]);

  // 无历史会话 → 空白草稿（单一权威入口；profile = 要清指针的目标 profile）
  const clearSessionView = useCallback((profile: string) => {
    // 🔴 P1-3: 同 loadSessionIntoView（2026-08-17 阶段4：多槽按会话归属不清；
    // 空草稿本身无交互，后台会话交互保留可见）
    setActiveSlashConfirm(null);
    sess.setSessionId(null);
    // 🔴 2026-08-22：空草稿（无历史会话）随时可发——会话在发送时创建
    sess.setSessionReady(true);
    clearSessionPointer(profile);
    sess.setFreshDraftReady(true);
    getWsClient().switchSession('');
    storeSetMessages([]);
  }, [sess]);

  // ═══════════════════════════════════════════════════════════════════
  //  多 Profile 会话恢复 — 启动时从 localStorage 恢复上次会话
  // ═══════════════════════════════════════════════════════════════════
  //
  // 数据源优先级:
  //   1. profile_session_map[currentProfile] — per-profile 指针（权威）
  //   2. 全局 session_id（旧版 fallback，可能是其他 profile 的）
  //
  // 🔴 串台防御: 无论哪个来源，都必须经 sessionIdMatchesProfile() 校验。
  // 不匹配 → targetId=null → 不恢复，用户从空会话开始（后端按 profile 新建）。
  // 详见 utils/session.ts 文件头的完整架构文档。
  //
  const startupRestored = useRef(false);
  useEffect(() => {
    // 🔴 P0-2: 必须等 profileResolved（getActiveProfile 完成）后才恢复，
    // 否则 currentProfile 还是 'default' 初始值，闩锁后真实 profile 永远不被恢复。
    // 🔴 P0-1: 必须等 storageReady（storage.init 成功）后才恢复，否则读空缓存永不恢复会话。
    if (!portReady || !profileResolved || !storageReady || startupRestored.current) return;
    startupRestored.current = true;
    const map = loadProfilePointers();
    const rawTarget = map[currentProfile] || (storage.load('session_id', null) as string | null);
    const targetId = rawTarget && sessionIdMatchesProfile(rawTarget, currentProfile) ? rawTarget : null;
    if (targetId) {
      resetStream(targetId); // 🔴 同步锁定权威 ref（loadSessionIntoView 守卫前提）
      loadSessionIntoView(targetId);
    }
  }, [portReady, profileResolved, storageReady, currentProfile, sess, resetStream, loadSessionIntoView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══════════════════════════════════════════════════════════════════
  //  多 Profile 切换 — 单视图 Agent 切换的完整生命周期
  // ═══════════════════════════════════════════════════════════════════
  //
  // 核心原则: 切换 = 纯前端换视图，后端是消息唯一权威源。
  // 切走不存消息到本地，切回始终从后端 loadHistory（含离开期间的消息）。
  //
  // 四步流程:
  //   Step 1: 记住指针 — 把当前 Agent 的 sessionId 写入 profile_session_map
  //           🔴 写入前校验归属（sessionIdMatchesProfile），防止污染扩散
  //   Step 2: 重置流式状态 — 清流式指示器 + 累加器 + streamId
  //   Step 3: 切换盖章 — setWsActiveProfile(name) 同步更新 WS 默认 profile
  //           保证后续 sendRpc 的 params.profile 盖章正确
  //   Step 4: 恢复目标会话 — 从 map 读取目标 Agent 的 session 指针
  //           🔴 读取后校验归属，不匹配则跳过（用户从空会话开始）
  //           恢复顺序: setSessionId → switchSession → 缓存秒显 → 后端 loadHistory
  //           → session.info 恢复 pending 交互弹窗（approval/clarify/sudo/secret）
  //
  // profile_session_map 数据流详见 GridModeView.tsx 文件头。
  // 串台防御完整架构详见 utils/session.ts 文件头。
  //
  // 🔴 2026-08-13 附件清理 ref（切 Agent 清附件；ref 避免依赖数组引用后定义的
  // clearImages/clearFilesAttachment 导致 TDZ——附件 hook 在下方定义）
  const clearImagesRef = useRef<() => void>(() => {});
  const clearFilesAttachmentRef = useRef<() => void>(() => {});
  const handleProfileChange = useCallback((name: string) => {
    // 🔴 2026-08-13 边界修复：同 Agent 重复点选短路——否则单视图重跑四步
    // （resetStream 重置流式状态 + loadSessionIntoView 清 pending 卡：
    // 流式中/审批中点当前 Agent 卡片会把审批卡清掉、流式 UI 重置）；
    // 宫格下同焦点卡片点选同样无需清 scope/pinned。
    if (name === currentProfile) return;
    // 🔴 宫格模式：只切 UI 焦点 + WS 盖章，不做会话保存/恢复（useGridChat 自管 per-agent session）。
    // 侧栏点选 / 宫格点选 都走此路径，currentProfile 是焦点唯一权威源。
    if (viewMode === 'grid') {
      setWsActiveProfile(name);
      setCurrentProfile(name);
      // 🔴 2026-08-12 断线修复：切 Agent 旧项目 scope 失效（对齐 Hermes 切 profile 后 scope stale）
      setProjectScopeCwd(null);
      // 🔴 2026-08-14 右侧面板抖动根治：切 Agent 不再立即 setPanelRoot(null)——
      // 保持旧面板直到新 Agent 激活项目恢复（fetchTree 后一次切换），避免
      // "未打开项目"占位 ↔ 文件树 两次切换的抖动（与左侧项目树 silent 同语义）
      newChatWorkspaceTargetRef.current = null; // 🔴 2026-08-13 边界：切 Agent 清手动导航落点
      return;
    }

    // 🔴 2026-08-13 边界修复：切 Agent 清附件（图片/文件条）——App 层附件是单视图
    // composer 级状态，跨 Agent 残留 = A 的附件串到 B 的会话（发送时按当前会话上传/注入）。
    // 切会话（同 Agent）保留（附件跟随用户输入意图，对齐 Hermes composer 语义）。
    clearImagesRef.current();
    clearFilesAttachmentRef.current();

    // ── Step 1: 记住指针（每个 Agent 上次用哪个 session） ──
    const map = loadProfilePointers();
    // 🔴 串台防御：只写入归属正确的 session 指针，防止污染扩散
    if (sess.sessionId && sessionIdMatchesProfile(sess.sessionId, currentProfile)) {
      map[currentProfile] = sess.sessionId; // 同步本地副本（Step 1b 读目标 key 不受影响，但保持语义一致）
      saveProfilePointer(currentProfile, sess.sessionId);
    }

    // ── Step 1b: 🔴 串台根因修复 — 先算目标 session（map 指针可能被历史污染，校验归属后才恢复） ──
    const rawTargetId = map[name] || null;
    const targetId = rawTargetId && sessionIdMatchesProfile(rawTargetId, name) ? rawTargetId : null;

    // ── Step 2: 重置流式状态 + 同步锁定过滤 ref 到目标 session（消灭 effect 异步串台窗口） ──
    resetStream(targetId);
    // 🔴 P0 修复：重置发送锁 + 清排队（否则源 Agent 的 message.complete 被过滤丢弃 → onDone 永不触发 → 锁泄漏 → 目标 Agent 发送瘫痪）
    resetSendingLockRef.current?.();

    // ── Step 3: 切换盖章（同步，保证后续 sendRpc 盖章正确） ──
    setWsActiveProfile(name);
    setCurrentProfile(name);
    // 🔴 2026-08-12 断线修复：切 Agent 旧项目 scope 失效（对齐 Hermes 切 profile 后 scope stale，
    //   否则新 Agent 说话时 getNewSessionCwd 返回旧 Agent 的项目根 → 新会话落错项目）
    setProjectScopeCwd(null);
    // 🔴 2026-08-14 右侧面板抖动根治：切 Agent 不再立即 setPanelRoot(null)——
    // 保持旧面板直到新 Agent 激活项目恢复（fetchTree 后一次切换），避免
    // "未打开项目"占位 ↔ 文件树 两次切换的抖动（与左侧项目树 silent 同语义）
    newChatWorkspaceTargetRef.current = null; // 🔴 2026-08-13 边界：切 Agent 清手动导航落点

    // ── Step 3b: 🔴 S2 修复 — 刷新会话列表（后端按 profile 过滤，S1 保证 sendRpc 盖章新 profile） ──
    sess.refresh();

    // ── Step 4: 恢复目标会话（后端是权威源，始终 loadHistory） ──
    if (targetId) {
      loadSessionIntoView(targetId);
      // 🔴 P0-1.2: pending 交互恢复依赖后端推送的 session.info 事件（WS 流建立时自动推送）
      // 实时审批/澄清/sudo/secret 由 useSSE/useMessageStream 事件处理器消费
    } else {
      // 无历史会话 → 空白草稿。
      // 🔴 串台/丢失修复：清的是目标 profile（name）的指针，不是源（currentProfile 是闭包旧值=切走的 Agent）。
      clearSessionView(name);
    }
  }, [sess, currentProfile, resetStream, viewMode, loadSessionIntoView, clearSessionView]);

  // 🔴 宫格→单视图：恢复目标 profile 的会话。
  // 宫格退出/展开前已由 GridModeView.persistPointers 把各 Agent 最新 session 指针写回
  // profile_session_map，故此处只从 map 读取 + 后端重加载。与 handleProfileChange 的区别：
  // 不回写“切走”会话（避免用陈旧的全局 sess.sessionId 覆盖宫格刚写回的权威指针）。
  const restoreProfileSession = useCallback((profile: string) => {
    const map = loadProfilePointers();
    const rawTarget = map[profile] || null;
    const targetId = rawTarget && sessionIdMatchesProfile(rawTarget, profile) ? rawTarget : null;
    // 🔴 串台根因修复：同步锁定过滤 ref 到目标 session（宫格→单视图同样消灭异步窗口）
    resetStream(targetId);
    // 🔴 P0 修复：宫格→单视图同样重置发送锁（宫格期间单视图锁可能被孤立流式事件锁死）
    resetSendingLockRef.current?.();
    setWsActiveProfile(profile);
    setCurrentProfile(profile);
    // 🔴 2026-08-13 边界修复：仅焦点变化时清 scope/pinned/target——
    // 宫格退出（restoreProfileSession(currentProfile)，焦点未变）保留宫格期间选的项目
    // （用户退出宫格应回到同一项目上下文）；展开其它卡片（焦点变）才清（旧焦点残留不带走）。
    if (profile !== currentProfile) {
      // 🔴 2026-08-12 断线修复：宫格→单视图同样清旧项目 scope（防新会话落错项目）
      setProjectScopeCwd(null);
      // 🔴 2026-08-16 一致性修复（审计 P2）：不再立即 setPanelRoot(null)——
      // 与 handleProfileChange 的"抖动根治"同款：保持旧面板直到新 Agent
      // 激活项目恢复（fetchTree 后 handleProjectScopeRestored 一次切换），
      // 避免"旧面板→未打开项目→新项目"两次切换闪烁。
      newChatWorkspaceTargetRef.current = null; // 🔴 2026-08-13 边界：宫格→单视图同样清手动导航落点
    }
    // 🔴 S2: 宫格→单视图同样刷新会话列表（与 handleProfileChange 一致）
    sess.refresh();
    // 🔴 2026-08-13 宫格→单视图同样清附件（宫格期间 App 层附件条不可见，
    // 进宫格前残留的附件退出后不应串到单视图会话）
    clearImagesRef.current();
    clearFilesAttachmentRef.current();
    if (targetId) {
      loadSessionIntoView(targetId);
      // 🔴 P0-1.2: 同上，pending 交互恢复依赖后端推送 session.info 事件
    } else {
      clearSessionView(profile); // 🔴 P1-6: 收敛到权威入口，同步清 map
    }
  }, [sess, resetStream, loadSessionIntoView, clearSessionView]);

  // 🔴 宫格命令式句柄：App 经此调度宫格（switchToSession 留宫格切会话 / persistPointers 退出前写回指针）
  const gridRef = useRef<GridModeViewHandle>(null);

  // 退出宫格（回到当前 profile 单视图）
  const handleExitGrid = useCallback(() => {
    gridRef.current?.persistPointers(); // 🔴 退出持久化权威收敛：Ctrl+G / 按钮退出都先写回各 Agent 指针
    setViewMode('single');
    restoreProfileSession(currentProfile);
  }, [restoreProfileSession, currentProfile]);
  exitGridRef.current = handleExitGrid; // 🔴 P1-3: 绑定到 toggleViewMode 的 ref

  // 展开某个 Agent 为单视图
  const handleExpandAgent = useCallback((profile: string) => {
    gridRef.current?.persistPointers(); // 🔴 同上：展开前写回指针
    setViewMode('single');
    restoreProfileSession(profile);
  }, [restoreProfileSession]);

  // ── useSessionActions: session switch/delete/new ──
  // 先于 usePromptActions 调用，因为 handleNewSession 需要传给 usePromptActions
  const {
    handleSwitchSession,
    handleDeleteSession,
    handleNewSession,
  } = useSessionActions({
    sess,
    genId,
    setSessionListVersion,
    resetSendingLock: () => resetSendingLockRef.current?.(), // 🔴 P0-1.1: ref 接线（同 drainQueueRef 模式）
    resetStream,
    currentSessionIdRef, // 🔴 BUG1: loadHistory 过期响应守卫用同步权威 ref
    currentProfile, // 🔴 2026-08-13 P2-1：切会话归属校验（防未知来源 id 串台 + 污染 map）
  });

  // 🔴 宫格"新建会话"全局副作用 — 复用 handleNewSession 同一套工具链，不重复造轮子
  // resetAgent（per-agent 状态槽归零）在 GridModeView 内部组合，这里只补全局语义：
  //   清 localStorage 指针 / 同步 WS client / 刷新侧栏会话列表
  const handleGridNewSessionEffects = useCallback((profile: string) => {
    // 🔴 P0-C: 先切盖章再 refresh，保证 sess.refresh() 拉的是目标 profile 的会话列表
    // （事件冒泡顺序：按钮 onClick 先于卡片 onClick，此时 setWsActiveProfile 尚未被 onFocusChange 调用）
    setWsActiveProfile(profile);
    removeProfilePointer(profile);
    getWsClient().switchSession('');
    sess.refresh();
    setSessionListVersion(v => v + 1);
  }, [sess, setSessionListVersion]);

  // 🔴 宫格模式：点击会话列表 → 解析归属 Agent → 宫格内切换该 Agent 卡片的会话（修复 BUG2：留宫格，不强行切单视图）。
  // 单视图模式：透传原始 handleSwitchSession。
  const gridAwareSwitchSession = useCallback((id: string) => {
    if (viewMode === 'grid') {
      const profile = profileFromSessionId(id) || currentProfile;
      gridRef.current?.switchToSession(profile, id);
      return;
    }
    handleSwitchSession(id);
  }, [viewMode, currentProfile, handleSwitchSession]);

  // 🔴 P2-6: 宫格模式侧栏“新建会话”路由进宫格（重置焦点 Agent 卡片，不切单视图）
  // 🔴 2026-08-11 对齐 Hermes openNewSessionTile：宫格新建 = 立即创建后端会话
  // 🔴 2026-08-12（老大需求：新建会话自动绑定当前 Agent + 选中项目）：
  //   scope（选中项目/workspace）注入新建会话链的单一入口——单视图新建按钮、
  //   /new 命令、宫格新建都走它；懒创建路径（无会话发消息）已由 getNewSessionCwd 消费
  const handleNewSessionWithScope = useCallback(async (title?: string) => {
    await handleNewSession(title, resolveNewSessionCwd() ?? undefined);
  }, [handleNewSession, resolveNewSessionCwd]);

  // （useSessions.create 激活——原无 UI 调用方的死链；卡片立即有真实会话而非懒创建）
  const gridAwareNewSession = useCallback(async () => {
    if (viewMode === 'grid') {
      // 🔴 2026-08-12 双创建断点修复：gridRef.newSession（handleGridNewSession）自
      //   2026-08-11 起已内部完整创建后端会话（resetAgent + onNewSessionEffects +
      //   sessionCreate + loadLatest + persistSessionPointer + onFocusChange）——
      //   旧代码再 sess.create + switchToSession = 第二次创建 → 第一个会话成孤儿。
      //   只走一条创建路径，scope（选中项目）由 newSession cwd 参数烙印。
      gridRef.current?.newSession(currentProfile, resolveNewSessionCwd() ?? undefined);
      return;
    }
    handleNewSessionWithScope();
  }, [viewMode, currentProfile, handleNewSessionWithScope, resolveNewSessionCwd]);

  // 🔴 P1-2: 在该项目新建会话（对齐 Hermes goToProject newSession → requestStartWorkSession(cwd)）：
  // 立即创建带 cwd 的会话（后端 session.create 写入 cwd 烙印 → resolve_session_cwd 生效），
  // 再切到新会话（复用 handleSwitchSession 完整切换链，不另起炉灶）。
  const handleNewSessionInProject = useCallback(async (cwd: string) => {
    try {
      const res = await getWsClient().sessionCreate({ profile: currentProfile, cwd });
      const sid = (res as SessionCreateResponse | null)?.session_id;
      if (!sid) throw new Error('创建会话失败');
      if (viewMode === 'grid') {
        gridRef.current?.switchToSession(currentProfile, sid);
      } else {
        await handleSwitchSession(sid);
      }
      setSessionListVersion(v => v + 1);
    } catch (e) {
      notifyError(e, '新建会话失败');
    }
  }, [currentProfile, viewMode, handleSwitchSession]);

  // 🔴 P2-6: 宫格模式侧栏“删除会话”路由进宫格（删后自动加载同 Agent 最新剩余会话，无则显示空态）
  const gridAwareDeleteSession = useCallback((id: string) => {
    // 🔴 2026-08-17 阶段4：会话删除 → 清该会话的交互项（后端已清 pending）
    removeInteraction(id);
    handleDeleteSession(id);
    if (viewMode === 'grid') {
      const owner = profileFromSessionId(id);
      if (owner) {
        // 找同 Agent 剩余会话（排除已删的，按 last_active 降序取最新）
        const remaining = sess.sessions
          .filter(s => s.id !== id && sessionIdMatchesProfile(s.id, owner))
          .sort((a, b) => b.last_active - a.last_active);
        if (remaining.length > 0) {
          gridRef.current?.switchToSession(owner, remaining[0].id);
        } else {
          gridRef.current?.newSession(owner);
        }
      }
    }
  }, [viewMode, handleDeleteSession, sess.sessions, removeInteraction]);

  // ── usePromptActions: send/regenerate/abort/queue ──
  const {
    handleSend: rawHandleSend,
    handleAbort,
    handleCommand,
    drainQueue,
    resetSendingLock,
    isSendingRef,
  } = usePromptActions({
    sess,
    genId,
    setConnectionStatus,
    addDebugEvent,
    setSessionListVersion,
    send,
    abort,
    // 🔴 2026-08-12：/new 命令走 scope 注入包装（新建会话自动绑定选中项目）
    handleNewSession: handleNewSessionWithScope,
    // 🔴 M-1/M-2 修复：不再传全局 currentModel/currentProvider —— 发送链不带 model，
    // 模型由后端 per-profile 权威管理（config.model_ref 热更新 + provider.switch override）
    onSlashConfirm: (data) => setActiveSlashConfirm(data),
    currentProfile,
    // 🔴 2026-08-11 对齐 Hermes workspaceCwdForNewSession（误对齐修正）：
    //   ① 项目 scope → 项目根（不变）
    //   ② 无 scope → DETACHED：仅显式 default_project_dir（本地 settings）或
    //      remote 记忆（seededCwdRef 启动 seed 时按模式写入）才预附加。
    //      ❌ 旧实现继承当前显示 cwd（sessionCwdRef）——sessionCwd 会被
    //      session.info 推成启动目录/上个会话目录，裸新聊天静默落错目录
    //      （Hermes #71873/#80213/#77496 教训；旧注释自称 Hermes 同款 = 误读）。
    getNewSessionCwd: resolveNewSessionCwd, // 🔴 2026-08-13 边界：统一单一漏斗（target > scope > seeded）
  });

  // 🔴 2026-08-12 联动重构（老大需求：选 Agent → 点项目/HOME → 消息区 + 右侧文件一起联动）：
  //   统一联动模型：
  //   ① 文件面板：项目 → 切项目根；HOME → 切该 Agent workspace（后端已把 workspace 注入
  //      Home 桶 path，Hermes 基线 Home 无路径可切，ELEVE 老大定义 HOME = Agent workspace）
  //   ② scope：项目 → 新会话落项目根；HOME → 新会话落 workspace（与后端 resolve_session_cwd
  //      ④级 workspace 兑底同源）；空 path（旧后端兑底）→ 退出项目域
  //   ③ 消息区：找该 Agent 该域的最新活跃会话（项目 = cwd 前缀匹配；HOME = workspace 域）
  //      → 有则切换（宫格=焦点卡片；单视图=完整切换链），无则空白草稿（懒创建落 scope）
  //      ；当前会话已属于该域且非 busy → 保持不打断
  const handleProjectEntered = useCallback((path: string, recommendedSessionId?: string | null) => {
    console.log(`[app] handleProjectEntered path=${path} rec=${recommendedSessionId}`);
    if (path) {
      setPanelRoot(path);        // ① 文件面板映射 → 项目绑定地址（视图，非项目地址本身）
      setSessionCwd(path);       // 终端/新会话落点 → 项目根（Hermes syncProjectCwd 语义）
      setProjectScopeCwd(path);  // ② 新会话落点 = 项目根 / workspace
      newChatWorkspaceTargetRef.current = null; // 🔴 2026-08-13 边界：点项目 = 项目意图覆盖手动导航
    } else {
      // 空 path（旧后端兑底/无绑定项目）：退出项目域；面板保持当前映射（无绑定地址可切）
      setProjectScopeCwd(null);
      newChatWorkspaceTargetRef.current = null;
    }
    // ③ 消息区联动（推荐会话 = 后端分组权威：项目 = 该项目 previewSessions 最新；
    //    HOME = Home 桶 unowned 全集最新；无推荐 → 前端域匹配兑底 → 空态新建）
    // 🔴 2026-08-16 架构修正（老大指示）：视图切换与任务执行解耦——焦点卡片
    // 运行中（busy）**允许**切换视图：运行中轮的输出在离开期间被 session 过滤
    // 隐藏，但轮在后台照常跑完、消息按迭代边界持久化；切回时 loadLatest /
    // loadHistory 重载（与断线重连同一已加固路径：attach → session.info 快照
    // + pending_prompts 恢复 + 全量历史），不丢结果。旧实现（审计 P1）busy
    // 时弹"任务运行中"阻止切换 = 把视图诉求错当成会话绑定变更，属糊弄。
    // 会话 cwd 绑定变更（同会话回根烙印/手动导航）才走 pending 轮末机制——
    // 运行中轮的工具环境不能中途挪走（后端 busy 拒绝 4009 是对的）。
    if (viewMode === 'grid') {
      // 宫格：焦点 Agent 卡片切推荐/兑底最新会话（与单视图同一 target 规则，走
      // gridAwareSwitchSession 统一入口——宫格下自动路由 gridRef，不平行直调）；
      // 无 → 新会话带项目 cwd（HOME 则 workspace），卡片自治不打扰其它卡片。
      // busy 切卡：loadLatest 重置累加器 + 释放发送锁 + 加载新会话消息；
      // 旧会话轮继续后台跑，其迟到事件由过期流守卫（#10）丢弃，锁不泄漏。
      const target = (recommendedSessionId && sessionIdMatchesProfile(recommendedSessionId, currentProfile))
        ? recommendedSessionId
        : (latestSessionForDomain(sess.sessions, currentProfile, path)?.id ?? null);
      if (target) {
        gridAwareSwitchSession(target);
      } else {
        gridRef.current?.newSession(currentProfile, path || undefined);
      }
      return;
    }
    const sid = sess.sessionId;
    const cur = sid ? sess.sessions.find((s) => s.id === sid) : undefined;
    const curCwd = cur?.cwd ?? null;
    // 路径边界判定（Windows 分隔符 + 大小写不敏感；防 C:\projAB 误判属于 C:\projA）
    const p = path.toLowerCase();
    const belongs = !!path && !!curCwd && (() => {
      const c = curCwd.toLowerCase();
      return c === p || c.startsWith(p + '\\') || c.startsWith(p + '/');
    })();
    // 🔴 2026-08-17 会话隔离修复（F1）：用户显式点击项目 = 明确的"消息区切到
    // 该项目"意图。busy 会话的 cwd 若落在所点项目域内（HOME 桶 = agent
    // workspace，新建项目通常位于其下 → cwd 前缀重叠），原"保持当前会话"
    // 早退分支会把消息区**钉在 busy 会话** → 之后每条消息都进 busy 会话
    // （busy 路由 queue/steer，无流式回复）→"切项目后说话没反应"。修复：
    // busy 时强制切离（切到目标会话 / 无目标则清空草稿，下一条消息落在所点
    // 项目）；仅当非 busy 且确实已在目标域时才保持（防重复点击打断）。
    const busy = isSendingRef.current || getIsStreaming();
    // 目标会话：推荐（后端分组权威）> 前端域匹配兑底。
    const target = (recommendedSessionId && sessionIdMatchesProfile(recommendedSessionId, currentProfile))
      ? recommendedSessionId
      : (latestSessionForDomain(sess.sessions, currentProfile, path)?.id ?? null);
    if (target) {
      if (target === sid) {
        // 目标 == 当前会话：非 busy 且已在目标域 → 保持（防重复点击打断）；
        // busy → 域内最新就是 busy 会话本身，切无可切 → 清空草稿（释放锁 +
        // 下一条消息新建会话落所点项目），把消息区从 busy 会话上摘下来。
        if (!busy && belongs) return;
        if (busy) {
          resetStream(null);
          resetSendingLockRef.current?.();
          clearSessionView(currentProfile);
        }
        return;
      }
      // 目标 != 当前会话 → 切换（busy 同样切——切走不打断后台轮，其迟到
      // 事件被 session 过滤丢弃，锁由 resetStream/loadHistory 链释放）。
      gridAwareSwitchSession(target);
      return;
    }
    // 无目标会话 → 空草稿：与 handleProfileChange 草稿路径同款重置——源会话的
    // message.complete 被 session 过滤丢弃 → onDone 不触发 → 发送锁/流式
    // 状态残留 → 新草稿发送瘫痪；必须先复位（resetStream 同步锁定过滤 ref）。
    resetStream(null);
    resetSendingLockRef.current?.();
    clearSessionView(currentProfile);
  }, [sess, isSendingRef, resetStream, resetSendingLockRef, clearSessionView, currentProfile, viewMode, gridAwareSwitchSession]);

  // 🔴 2026-08-13 老大语义重构：会话行点击 → 只同步 scope（新会话落点）；
  // 文件面板是项目映射视图（只跟项目卡片/手动导航），不随会话行点击改变。
  const handleProjectScopeChange = useCallback((path: string | null) => {
    setProjectScopeCwd(path);
    // 🔴 2026-08-13 边界：会话行点击 = 项目域意图 → 清手动导航落点
    newChatWorkspaceTargetRef.current = null;
  }, []);

  // 🔴 2026-08-13 切 Agent 恢复激活项目（老大反馈：项目选中态来自后端 active_id，
  // 但 scope/文件面板被切 Agent 清空 → 右侧抽屉"未打开项目"，必须再点一次）：
  // 项目树切 Agent 后首次加载完成 → 该 Agent 有 active 项目 → 恢复 scope + 文件面板
  // 到激活项目根；**不钉住**——会话真实 cwd 已到达（session.info 先于 fetchTree 响应）
  // 时保持跟随（会话 cwd 是展示权威，active 项目仅当无会话 cwd 时兜底）；
  // 会话无绑定（bound 空）→ handleSessionInfoCwd 的 scope 兜底显示项目根。
  // 不动消息区（会话指针恢复由 handleProfileChange 管）。
  const handleProjectScopeRestored = useCallback((path: string | null) => {
    setProjectScopeCwd(path);
    newChatWorkspaceTargetRef.current = null;
    if (path) {
      // 🔴 2026-08-13 老大语义重构：切 Agent 恢复激活项目 → 面板映射到项目绑定地址
      // （无“锁”：映射随用户动作变，项目地址永不变）
      setPanelRoot(path);
    } else {
      // 🔴 2026-08-14：新 Agent 无激活项目 → 最终态清面板（显示“未打开项目”）——
      // 一次切换（旧面板 → 占位），而非切 Agent 时立即清再恢复的两次切换
      setPanelRoot(null);
    }
  }, []);

  // 🔴 P1: 宫格模式 CommandCenter（CMD+K）命令执行路由进宫格（写入 per-agent 状态槽，非不可见的 zustand store）
  const gridAwareCommand = useCallback((cmdName: string, args: string) => {
    if (viewMode === 'grid') {
      // 🔴 2026-08-12（老大需求：新建会话自动绑定选中 Agent+项目）：宫格 /new 命令
      //   前端拦截 → 卡片新建带 scope cwd（后端 slash 无前端 scope 概念，直传会落
      //   workspace 而非选中项目）
      if (cmdName === 'new' || cmdName === 'reset') {
        gridRef.current?.newSession(currentProfile, resolveNewSessionCwd() ?? undefined);
        return;
      }
      gridRef.current?.execCommand(currentProfile, cmdName, args);
      return;
    }
    handleCommand(cmdName, args);
  }, [viewMode, currentProfile, handleCommand]);

  // ── useImageAttachments: 图片附件状态管理 ──
  // 对齐 Hermes Desktop: prompt.submit 后后端自动 drain session.attached_images
  // 前端在发送成功后清空本地预览状态
  const {
    attachedImages,
    uploading: imageUploading,
    error: imageError,
    addImage,
    addImageFromPath,
    addExternalImage,
    removeImage,
    clearImages,
    clearError: clearImageError,
    uploadUnuploaded,
  } = useImageAttachments({ getSessionId: () => sess.sessionId });

  // 🔴 2026-08-22 重构：聊天图片编辑 = 主窗口内嵌编辑器（壳独立能力，
  // 与画布插件零耦合，不弹新窗口）。Context 提供全局入口：
  // - 输入区附件编辑带 originalId → 确认后【替换】原附件
  // - 消息区图片编辑不带 originalId → 标注图作为新附件
  // 编辑都在标注图副本上进行，不影响原图。
  const [imageEditorTarget, setImageEditorTarget] = useState<ImageEditorTarget | null>(null);
  const imageEditorApi = useMemo<ImageEditorApi>(() => ({
    target: imageEditorTarget,
    openImageEditor: (src: string, name?: string, originalId?: string) => setImageEditorTarget({ src, name, originalId }),
    closeImageEditor: () => setImageEditorTarget(null),
  }), [imageEditorTarget]);

  // 🔴 2026-08-09 文件附件状态管理（右侧文件树拖文件到聊天区 → 附件条 pill）：
  // 对齐 Hermes uploadComposerAttachment 文件分支——file.attach staging + ref_text
  // 发送时注入 prompt 文本（@file:相对路径）
  const {
    attachedFiles,
    attaching: fileAttaching,
    error: fileError,
    attachPaths,
    removeFile: handleRemoveFile,
    clearFiles: clearFilesAttachment,
    clearError: clearFileError,
  } = useFileAttachments({ getSessionId: () => sess.sessionId });
  // 🔴 2026-08-13：附件清理 ref 接线（切 Agent/宫格退出时调用；useImageAttachments 的
  // clearImages 在上一解构块，一并同步）
  clearImagesRef.current = clearImages;
  clearFilesAttachmentRef.current = clearFilesAttachment;

  // 图片大图预览（对齐 Hermes ImageLightbox：聊天区缩略图点击 → 遮罩大图 + 下载）
  const [lightbox, setLightbox] = useState<{ src: string; name?: string; onEdit?: () => void } | null>(null);

  // 包装 handleSend — 附件排队归属 + 发送后清空预览
  // 🔴 对齐 Hermes entry 级附件归属：busy 时排队附件 base64 暂存内存 + 从 session 分离
  const handleSend = useCallback(async (text: string) => {
    // F5: barge-in — 用户发消息即打断正在播放的 TTS（对齐 Hermes
    // server.py L12842: 新 turn 开始 → _tts_stream_stop(user_barge=True)）。
    // fire-and-forget：打断失败不影响发送主流程。
    getWsClient().voiceTtsStop().catch(() => {});
    const wasBusy = isSendingRef.current;
    const images = [...attachedImages];

    // 🔴 2026-08-22 移除会话就绪门禁（严重消息流转 BUG 修复）：
    // 原门禁（waitSessionReady + alert）会误挡——新装/无历史会话时 sessionReady
    // 永不置位（启动恢复只有 if(targetId) 分支，无历史不触发 loadSessionIntoView），
    // 导致每条消息都弹"正在恢复会话"+丢消息。
    // 对齐 Hermes：发送前 ensure session（无会话才创建），不阻塞等待——
    // 会话未加载由后端 get_or_create 兜底恢复（resolve_attach_session），
    // 消息绝不因等待被吞。

    // 🔴 新会话图片附件 submit 时序（对齐 Hermes submit.ts: createBackendSessionForSend → syncAttachmentsForSubmit → prompt.submit）
    // 无会话时 addImage 仅本地暂存（uploaded=false）；此处发送前懒创建会话并上传，
    // 保证图片进入后端 session.attached_images，随后 prompt.submit 被后端 drain 消费。
    // 🔴 2026-08-22 修复：移除 !wasBusy 条件——busy（上一条还在处理）时也先 attach，
    // 否则图片不进 session → Queue 快照 attached_images 为空 → ELEVE 收不到图
    // （只收到文字）。busy 与 idle 统一：先 attach 再提交，附件归属后端权威。
    // 🔴 2026-08-27 纯图排查决定性日志
    console.info('[handleSend] images snapshot:', images.map(i => ({ name: i.name, uploaded: i.uploaded })),
      '| needUpload=', images.some((img) => !img.uploaded));
    if (images.some((img) => !img.uploaded)) {
      const ws = getWsClient();
      // 🔴 2026-08-27 同步读（ref 双写，见 useSessions.getSessionId 注释）
      let sid = sess.getSessionId() ?? undefined;
      console.info('[handleSend] upload block entered, sid=', sid);
      if (!sid) {
        try {
          // 🔴 2026-08-11 对齐 Hermes createBackendSessionForSend（detached 语义）：
          // 项目 scope → 项目根；无 scope → 仅显式 default_project_dir / remote 记忆
          // （seededCwdRef）；❌ 不再继承当前显示 cwd（session.info 可能推成启动目录）
          let cwd: string | undefined;
          // 🔴 2026-08-13 边界：统一单一漏斗（手动导航 target > 项目 scope > 启动 seed）
          cwd = resolveNewSessionCwd() ?? undefined;
          const created = await ws.sessionCreate({
            profile: currentProfile,
            title: sess.pendingTitle ?? undefined,
            ...(cwd ? { cwd } : {}),
          });
          sid = created.session_id;
          sess.setSessionId(sid);
          // 🔴 2026-08-11 修复：同 usePromptActions sessionCreate 分支（指针落盘）
          persistSessionPointer(sid);
          ws.switchSession(sid);
        } catch (err) {
          console.error('[handleSend] sessionCreate failed, aborting send:', err);
          return; // 对齐 Hermes: 建会话失败 → 中止发送
        }
      }
      const synced = await uploadUnuploaded(sid);
      // 🔴 2026-08-22：会话就绪门禁（上方）已保证 sid 对后端就绪——正常不再
      // 出现 session not found；若仍失败（非会话类错误），明确提示，不静默。
      if (!synced.ok) {
        alert(`图片上传失败：${synced.error || '未知错误'}，请重试`);
        return; // 对齐 Hermes: 附件同步失败 → 中止发送
      }
      // 🔴 2026-08-13 深度审查竞态修复：上传 await 期间用户可能切 Agent/会话——
      // 旧附件（图片内容/文件引用）不得发到新会话（跨 Agent 内容串台）。
      // 中止发送 + 已上传图片从旧会话 detach（防残留 → 旧会话下次 submit 幽灵 drain 误发）。
      // 🔴🔴 2026-08-27 纯图首轮必挂的真凶修复：此处原来读 sess.sessionId
      // （React state，懒创建后同事件循环内是 stale null/旧值）→ 恒不等于 sid
      // → 刚 attach 的两张图被误 detach + 放弃发送 = "按一次没效果"；第二次点击
      // 时图已 uploaded=true 跳过上传、后端已被剥空 → 占位符回复看不到图。
      // 对齐 Hermes createBackendSessionForSend：attach 与 submit 的会话一致性
      // 由同一闭包变量保证，**不存在事后剥离回滚**；本守卫保留防真串台，但比较
      // 源必须与创建侧一致（getSessionId ref 同步读）。
      if (sess.getSessionId() !== sid) {
        const ws = getWsClient();
        for (const p of synced.paths) {
          ws.imageDetach(p, sid).catch(() => {});
        }
        return;
      }
    }

    // 准备附件 data URL（乐观上屏缩略图用；附件本体已由 uploadUnuploaded 附着后端 session）
    const dataURLs = images.map((img) => img.preview);

    // 🔴 2026-08-09 文件附件 ref_text 注入（对齐 Hermes attachment.refText 语义）：
    // file.attach staging 的引用（@file:相对路径）合并进 prompt 文本，LLM 经 @file: 读取
    const fileRefs = attachedFiles.map((f) => f.refText).join(' ');
    const finalText = fileRefs ? `${fileRefs}\n${text}` : text;

    rawHandleSend(finalText, dataURLs.length > 0 ? dataURLs : undefined);

    // 🔴 2026-08-16 方案A：附件归属后端权威——busy 直发后端 route_busy_submit：
    // media 非空必 fall through Queue，Queue 快照接管 attached_images 后
    // 后端自行 detach_image（dispatch.rs），Overflow 时保留 for retry；
    // 前端不再做条目级 imageDetach（旧前端自治队列配套，已退役）。
    // 发送/排后都清本地预览（后端 prompt.submit 自动 drain / 排队已暂存）
    if (images.length > 0) {
      clearImages();
    }
    if (attachedFiles.length > 0) {
      clearFilesAttachment();
    }
  }, [rawHandleSend, attachedImages, clearImages, isSendingRef, sess.sessionId, sess, currentProfile, uploadUnuploaded, attachedFiles, clearFilesAttachment]);

  // 适配 addImage 签名：useImageAttachments 返回 Promise<AttachedImage | null>，
  // InputArea 的 onAddImage 期望 Promise<void>，丢弃返回值即可
  const handleAddImage = useCallback(async (file: File): Promise<void> => {
    await addImage(file);
  }, [addImage]);

  // 同款适配：Tauri 路径快路径（本地 image.attach / remote attach_bytes）
  const handleAddImageFromPath = useCallback(async (path: string): Promise<void> => {
    await addImageFromPath(path);
  }, [addImageFromPath]);

  // 适配 removeImage 签名
  const handleRemoveImage = useCallback(async (id: string): Promise<void> => {
    await removeImage(id);
  }, [removeImage]);

  // Wire up drainQueueRef after drainQueue is created
  drainQueueRef.current = drainQueue;
  // 🔴 P0-1.1: Wire up resetSendingLockRef（useSessionActions 在 usePromptActions 之前调用，用 ref 打破循环）
  resetSendingLockRef.current = resetSendingLock;

  // ── 禁用右键菜单 + 键盘刷新（聊天面板不是网页）──
  useEffect(() => {
    const preventMenu = (e: Event) => e.preventDefault();
    const preventRefresh = (e: KeyboardEvent) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('contextmenu', preventMenu);
    document.addEventListener('keydown', preventRefresh as EventListener);
    return () => {
      document.removeEventListener('contextmenu', preventMenu);
      document.removeEventListener('keydown', preventRefresh as EventListener);
    };
  }, []);

  // 🔴 2026-08-13 Phase 2 拆分：mount 编排（markdown deps + 端口发现 + storage 恢复）、
  // WS 连接管理、beforeunload 落盘已移入 useBootstrap（纯移动，无逻辑变更）。

  // ── clarify done（2026-08-17 阶段4：按会话关闭多槽项）──
  const handleClarifyDone = useCallback((sessionId: string) => {
    removeInteraction(sessionId);
  }, [removeInteraction]);

  // ── approval done（2026-08-17 阶段4：按会话关闭多槽项）──
  const handleApprovalDone = useCallback((sessionId: string) => {
    removeInteraction(sessionId);
  }, [removeInteraction]);

  // ── slash confirm done（D1：破坏性命令确认结果处理）──
  const handleSlashConfirmDone = useCallback((choice: string, result?: any) => {
    setActiveSlashConfirm(null);
    if (choice === 'cancel' || !result) return;
    // 后端已重新执行命令，返回 { type: "exec", output, session_id? }
    const output = result?.output || '';
    const newSid = result?.session_id;
    if (newSid && newSid !== sess.sessionId) {
      if (sess.sessionId) {
        storeSetMessages((prev) => {
          sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: prev }));
          return prev;
        });
      }
      sess.setSessionId(newSid);
      persistSessionPointer(newSid);
      sess.refresh();
      setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
      storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
    } else {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
    }
  }, [sess, genId, setSessionListVersion]);

  // ── sudo done（2026-08-17 阶段4：按会话参数化——request_id 从交互项取）──
  const handleSudoDone = useCallback(async (sessionId: string, password: string) => {
    const it = pendingInteractions[sessionId];
    if (!it || it.kind !== 'sudo') return;
    try {
      await call('sudo_respond', { request_id: it.data.request_id, password });
    } catch { /* 静默处理 */ }
    removeInteraction(sessionId);
  }, [pendingInteractions, removeInteraction]);

  // ── secret done（2026-08-17 阶段4：按会话参数化）──
  const handleSecretDone = useCallback(async (sessionId: string, value: string) => {
    const it = pendingInteractions[sessionId];
    if (!it || it.kind !== 'secret') return;
    try {
      await call('secret_respond', { request_id: it.data.request_id, value });
    } catch { /* 静默处理 */ }
    removeInteraction(sessionId);
  }, [pendingInteractions, removeInteraction]);

  // ── command center navigation ──
  const handleNavigate = useCallback((panel: string) => {
    // 🔴 2026-08-10 日志已搬入 LOGO 面板（GatewayPanel 内嵌 LogsPanel），移除 overlay 入口
    setActivePanel(panel);
  }, []);

  // ── restart backend ──
  const handleRestartService = useCallback(async () => {
    try {
      const { restartService } = await import('./utils/bridge');
      await restartService();
    } catch (err) {
      console.error('Restart failed:', err);
    }
  }, []);

  // ── keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') { e.preventDefault(); gridAwareNewSession(); }
      if (mod && e.key === 'w') {
        // 对齐 Hermes view.closeTab（⌘W = 关闭当前预览 tab）：有预览 tab → 关 tab；
        // 无预览 tab → 保留旧语义关窗（Hermes 无此场景，但保留用户习惯）
        const previewState = getPreviewStoreState();
        if (previewState.tabs.length > 0 && previewState.activeId) {
          e.preventDefault();
          closePreviewTab(previewState.activeId);
          return;
        }
        e.preventDefault();
        tauriWindow?.close();
      }
      if (mod && e.key === 'l') { e.preventDefault(); (document.getElementById('input') as HTMLElement)?.focus(); }
      if (mod && e.key === 'k') { e.preventDefault(); setCommandCenterOpen((v) => !v); }
      if (e.key === 'Escape') {
        if ((document.activeElement as HTMLElement)?.id === 'input') (document.activeElement as HTMLElement).blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [gridAwareNewSession]);

  // ── wake.detected 订阅：唤醒词命中 → 开新会话（对齐 Hermes wiring.tsx:686
  //   newSessionInProfile / startFreshSessionDraft；提示音已在 handleGlobalEvent 播放）──
  // 多 profile 路由：命中归属 profile ≠ 当前 → 切 profile + 开新会话（对齐 Hermes
  //   targetProfile re-home + newSessionInProfile）；否则当前 profile 开新会话。
  useEffect(() => {
    return onWakeDetected((detail) => {
      const targetProfile = detail.profile?.trim();
      if (targetProfile && targetProfile !== currentProfile) {
        // 对齐 Hermes：唤醒词归属 profile 先 re-home（切盖章）再开新会话；
        // 🔴 2026-08-12：跨 profile 不带当前 scope（新 profile 无选中项目，落其 workspace）
        setWsActiveProfile(targetProfile);
        getWsClient().switchSession('');
        if (viewMode === 'grid') {
          gridRef.current?.newSession(targetProfile);
        } else {
          handleNewSession();
        }
      } else {
        gridAwareNewSession();
      }
    });
  }, [gridAwareNewSession, currentProfile, viewMode, handleNewSession]);

  // ── titlebar controls ──
  const winMin = () => tauriWindow?.minimize();
  const winMax = async () => {
    if (!tauriWindow) return;
    if (await tauriWindow.isMaximized()) tauriWindow.unmaximize();
    else tauriWindow.maximize();
  };
  const winClose = () => tauriWindow?.close();

  // ── titlebar element ──
  const titlebarEl = (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={viewMode === 'grid' ? handleExitGrid : winMax}>
      <div className="titlebar-actions">
        <button className="tb-btn" id="btn-min" title="最小化" onClick={winMin}><Minus size={14} strokeWidth={1.5} /></button>
        <button className="tb-btn" id="btn-max" title="最大化" onClick={winMax}><Square size={12} strokeWidth={1.5} /></button>
        <button className="tb-btn tb-btn-close" id="btn-close" title="关闭" onClick={winClose}><X size={14} strokeWidth={1.5} /></button>
      </div>
    </div>
  );

  const modelContextValue = useMemo(() => ({
    currentModel: modelDiscovery.selectedModel || modelName || undefined,
    grouped: modelDiscovery.grouped,
    loading: modelDiscovery.loading,
    error: modelDiscovery.error,
    onSelect: modelDiscovery.selectModel,
    onOpenSettings: handleOpenSettings,
    onRefresh: modelDiscovery.refresh,
  }), [modelDiscovery.selectedModel, modelName, modelDiscovery.grouped, modelDiscovery.loading, modelDiscovery.error, modelDiscovery.selectModel, handleOpenSettings, modelDiscovery.refresh]);

  return (
    <ThemeProvider>
      <ImageEditorContext.Provider value={imageEditorApi}>
      <ModelProvider value={modelContextValue}>
      <AppShell
        titlebar={titlebarEl}
        connectionStatus={connectionStatus}
        gatewayOnline={gatewayHealth.online}
        gatewayChecking={gatewayHealth.checking}
        sessionId={sess.sessionId}
        profileName={currentProfileLabel}
        onOpenSettings={handleOpenSettings}
      >
        {/* ===== PaneShell 三栏布局：图标栏 + 侧边面板 + 聊天区 ===== */}
        <ErrorBoundary>
        <PaneShell
          leftOpen={true}
          leftWidth={activePanel ? `${52 + panelWidth}px` : '52px'}
          onLeftResize={(w: number) => setPanelWidth(Math.max(268, Math.min(500, w - 52)))}
          onLeftToggle={() => setActivePanel(activePanel ? null : 'agents')}
          // 🔴 2026-08-12 老大：Agent 面板最小宽度 320（总宽，含 52px 图标栏）——
          //   拖拽不得让卡片/文字变形（面板最小 268px；初始 260px 不受影响）
          minLeftWidth={320}
          maxLeftWidth={500}
          rightOpen={rightOpen}
          rightWidth={`${rightAnchor.rightW}px`}
          rightAnchor={rightAnchor}
          // 🔴 右栏宽度范围（2026-08-05 放宽至 240-800；2026-08-08 下限提至 320）：
          // 顶部 4 个 tab 按钮（文件/终端/预览/产物 + 关闭钮）需要 ~314px，
          // 240 时文字被压缩变形。max 800 覆盖窗口增量分配上限。
          onRightResize={(w: number) => setRightAnchor({ winW: window.innerWidth, rightW: Math.max(320, Math.min(800, w)) })}
          onRightToggle={handleToggleFiles}
          minRightWidth={320}
          maxRightWidth={800}
          minMainWidth={MIN_CHAT_WIDTH}
          className="app-pane-shell"
        >
          {/* 左侧面板：图标栏 + 侧边面板卡片 */}
          <Pane side="left" className="pane-left-column">
            <IconBar activePanel={activePanel} onPanelChange={setActivePanel} onOpenOverlay={handleOpenOverlay} gatewayOnline={gatewayHealth.online} onToggleFiles={handleToggleFiles} onOpenCanvas={handleOpenCanvas} />
            {activePanel && (
              <div className="side-panel-card">
                <SidePanel
                  activePanel={activePanel}
                  onPanelChange={setActivePanel}
                  // 🔴 网关状态透传（GatewayPanel 需要）：SidePanel 未传 gatewayOnline →
                  // GatewayPanel 的 gatewayOnline=undefined → 恒显示"网关未连接"且无重连按钮
                  gatewayOnline={gatewayHealth.online}
                  gatewayChecking={gatewayHealth.checking}
                  onGatewayRetry={gatewayHealth.checkNow}
                  currentProfile={currentProfile}
                  currentProfileLabel={currentProfileLabel}
                  onProfileChange={handleProfileChange}
                  onProfilesChange={handleProfilesChange}
                  onDisplayNamesChange={setDisplayNames}
                  onColorsChange={setAgentColors}
                  onAvatarKeysChange={setAgentAvatarKeys}
                  refreshSignal={profileRefreshSignal}
                  onEditAgent={setEditTarget}
                  onOpenSettings={handleOpenSettings}
                  onRestart={handleRestartService}
                  sessionId={viewMode === 'grid' ? (focusedGridSessionId ?? sess.sessionId) : sess.sessionId}
                  sessions={sess.sessions}
                  onSwitchSession={gridAwareSwitchSession}
                  onDeleteSession={gridAwareDeleteSession}
                  sessionTitles={sess.titles}
                  onRenameTitle={sess.setTitle}
                  onNewSession={gridAwareNewSession}
                  isStreaming={isStreaming}
                  messageCount={messageCount}
                  onNewSessionInProject={handleNewSessionInProject}
                  onEnterProject={handleProjectEntered}
                  onProjectScopeChange={handleProjectScopeChange}
  onProjectScopeRestored={handleProjectScopeRestored}
                  sessionListVersion={sessionListVersion}
                  agentCount={agentCount}
                />
            </div>
            )}
          </Pane>

          {/* 右侧聊天主区域 */}
          <PaneMain>
            {viewMode === 'grid' ? (
              <div className="chat-card">
                <GridModeView
                  ref={gridRef}
                  currentProfile={currentProfile}
                  currentSessionId={sess.sessionId}
                  onExitGrid={handleExitGrid}
                  onExpandAgent={handleExpandAgent}
                  onFocusChange={handleProfileChange}
  // 🔴 2026-08-13 并发修复：宫格/独立窗口复用同一 handleSessionInfoCwd（焦点卡片 session.info
  // → 文件面板跟随，含项目钉住检查）；GridModeView 经 useGridChat opts 接线
                  onFocusedSessionChange={setFocusedGridSessionId}
                  onSessionCwd={handleSessionInfoCwd}
                  portReady={portReady}
                  onNewSessionEffects={handleGridNewSessionEffects}
                  getNewSessionCwd={resolveNewSessionCwd}
                  onSelectModel={handleGridSelectModel}
                />
              </div>
            ) : (
            <div className="chat-card min-w-[480px]" ref={chatCardRef}>
            {responsiveCollapsed && (
              <button
                className="absolute top-2 left-2 z-20 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
                aria-label="Expand sidebar"
                title="展开侧边面板"
                onClick={() => setActivePanel('agents')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <main
              className="chat-area"
              id="page-chat"
              onDragOver={(e) => {
                // 🔴 2026-08-09 放行文件树路径拖拽（附件条）+ 系统图片文件
                if (Array.from(e.dataTransfer.types).includes('Files') || dragHasPaths(e.dataTransfer)) e.preventDefault();
              }}
              onDrop={(e) => {
                // 🔴 2026-08-09 文件树路径拖入 → 附件条（对齐 Hermes use-composer-drop
                // 附件语义）：图片路径走 addImageFromPath 缩略图，其它文件走 attachPaths pill
                if (dragHasPaths(e.dataTransfer)) {
                  const paths = collectDroppedPaths(e.dataTransfer);
                  if (paths.length > 0) {
                    e.preventDefault();
                    const imagePaths: string[] = [];
                    const filePaths: string[] = [];
                    for (const p of paths) {
                      if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(p)) imagePaths.push(p);
                      else filePaths.push(p);
                    }
                    if (imagePaths.length > 0) {
                      for (const p of imagePaths) void handleAddImageFromPath(p);
                    }
                    if (filePaths.length > 0) void attachPaths(filePaths);
                  }
                  return;
                }
                const files = Array.from(e.dataTransfer.files);
                const imageFiles = files.filter((f) => f.type.startsWith('image/'));
                if (imageFiles.length === 0) return;
                e.preventDefault();
                for (const file of imageFiles) {
                  void handleAddImage(file);
                }
              }}
            >
              <ToolStatusBar sessionId={sess.sessionId} isStreaming={isStreaming} onToggleViewMode={toggleViewMode} />
              {/* 🔴 2026-08-15 子 Agent 监控面板改由 ToolStatusBar 的"监控"按钮控制开合，
                  不再无条件挂载（原先弹出后收不回去、遮挡主聊天窗口） */}
              {!portReady && messageCount === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                  <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 14 }}>正在连接 Agent...</p>
                </div>
              ) : (
                <>
                  <MessageContainer
                    gatewayOnline={gatewayHealth.online}
                    onGatewayRetry={gatewayHealth.checkNow}
                    onOpenSettings={handleOpenSettings}
                    hasModels={modelDiscovery.models.length > 0}
                    sessionKey={sess.sessionId ?? null}
                  />

                  {/* 🔴 2026-08-09 附件预览条——聊天区底部（对齐 Hermes AttachmentList）：
                      图片缩略图（老大要求 48px + 聊天区位置）+ 文件 pill（2026-08-09 新增，
                      文件树拖入）。点击缩略图 → ImageLightbox 大图预览（对齐 Hermes AttachmentPill）。 */}
                  {(attachedImages.length > 0 || (imageUploading ?? 0) > 0 || !!imageError || attachedFiles.length > 0 || (fileAttaching ?? 0) > 0 || !!fileError) && (
                    <div className="px-3 pt-2 flex flex-col gap-1.5">
                      {attachedImages.length > 0 && (
                        <div className="flex gap-2 flex-wrap items-start">
                          {attachedImages.map((img, index) => (
                            <div key={img.id} className="relative group">
                              <img
                                src={img.preview}
                                alt={img.name}
                                className="w-12 h-12 object-cover rounded-md border border-border cursor-zoom-in"
                                draggable={false}
                                onClick={() => setLightbox({ src: img.preview, name: img.name, onEdit: () => { setLightbox(null); imageEditorApi.openImageEditor(img.preview, img.name, img.id); } })}
                              />
                              {/* 🔴 2026-08-21：图片编辑（hover 显示，不常显）——
                                  2026-08-22 重构：主窗口内嵌编辑器，确认后替换原图；
                                  2026-08-25：改名「编辑」（重绘仅画布提供） */}
                              <button
                                onClick={(e) => { e.stopPropagation(); imageEditorApi.openImageEditor(img.preview, img.name, img.id); }}
                                className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/90"
                                title="编辑图片（涂抹标记要修改的区域）"
                                aria-label={`Edit ${img.name}`}
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => { void handleRemoveImage(img.id); }}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-primary-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                                title="移除图片"
                                aria-label={`Remove ${img.name}`}
                              >
                                ✕
                              </button>
                              {/* 🔴 2026-08-22：附件显示"图N"（实时编号，用户可明确指代；
                                  后端 attach text 同序号 → LLM 分清图1/图2/图3） */}
                              <div className="text-xs text-muted-foreground truncate mt-1 max-w-[48px]" title={img.name}>
                                图{index + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {imageError && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                          <span className="flex-1 truncate">{imageError}</span>
                          <button
                            onClick={clearImageError}
                            className="shrink-0 hover:opacity-70"
                            aria-label="Dismiss error"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      {(imageUploading ?? 0) > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          上传图片中… ({imageUploading})
                        </div>
                      )}
                      {/* 🔴 2026-08-09 文件附件 pill（对齐 Hermes AttachmentPill 文件分支） */}
                      {attachedFiles.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap items-center">
                          {attachedFiles.map((f) => (
                            <div
                              key={f.id}
                              className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card/70 text-xs max-w-[280px]"
                              title={f.path}
                            >
                              <FileText size={13} className="shrink-0 text-muted-foreground" />
                              <span className="truncate min-w-0 flex-1">{f.name}</span>
                              <button
                                onClick={() => { void handleRemoveFile(f.id); }}
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                title="移除附件"
                                aria-label={`Remove ${f.name}`}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {(fileAttaching ?? 0) > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          附加文件中…
                        </div>
                      )}
                      {fileError && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                          <span className="flex-1 truncate">{fileError}</span>
                          <button
                            onClick={clearFileError}
                            className="shrink-0 hover:opacity-70"
                            aria-label="Dismiss error"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.name} onClose={() => setLightbox(null)} onEdit={lightbox.onEdit} />}
                  {/* 🔴 2026-08-22：图片编辑器（主窗口内嵌全屏层，壳独立能力）——
                      确认后按 originalId 替换原附件 / 无则新增；编辑不影响原图 */}
                  {imageEditorTarget && (
                    <ImageEditorModal
                      src={imageEditorTarget.src}
                      name={imageEditorTarget.name}
                      onCancel={imageEditorApi.closeImageEditor}
                      onConfirm={(dataUrl, n) => {
                        if (imageEditorTarget.originalId) {
                          void removeImage(imageEditorTarget.originalId);
                        }
                        imageEditorApi.closeImageEditor();
                        addExternalImage(dataUrl, n);
                      }}
                    />
                  )}
                  {/* 🔴 2026-08-17 阶段4：当前会话的交互卡片（从多槽取当前 sid） */}
                  {currentClarify && (
                    <ClarifyCard
                      clarifyId={currentClarify.clarify_id}
                      question={currentClarify.question}
                      choices={currentClarify.choices}
                      multiSelect={currentClarify.multi_select}
                      onDone={() => handleClarifyDone(currentClarifySessionId)}
                    />
                  )}
                  {currentClarifyBatch && (
                    <ClarifyBatchCard
                      clarifyId={currentClarifyBatch.clarify_id ?? ''}
                      title={currentClarifyBatch.title}
                      questions={currentClarifyBatch.questions ?? []}
                      onDone={() => handleClarifyDone(currentClarifyBatchSessionId)}
                    />
                  )}
                  {currentApproval && (
                    <ApprovalCard
                      command={currentApproval.command}
                      description={currentApproval.description}
                      pattern={currentApproval.pattern}
                      choices={currentApproval.choices}
                      run_id={currentApproval.run_id}
                      onDone={() => handleApprovalDone(currentApprovalSessionId)}
                    />
                  )}
                  {/* SlashConfirmCard — 破坏性斜杠命令确认（D1） */}
                  {activeSlashConfirm && (
                    <SlashConfirmCard
                      confirmId={activeSlashConfirm.confirmId}
                      command={activeSlashConfirm.command}
                      description={activeSlashConfirm.description}
                      sessionId={sess.sessionId ?? undefined}
                      onDone={handleSlashConfirmDone}
                    />
                  )}
                  {/* SudoCard — 密码输入 */}
                  {currentSudo && (
                    <CredentialCard
                      type="sudo"
                      title="Sudo 权限请求"
                      description={currentSudo.prompt || '需要 sudo 密码'}
                      onSubmit={(pw) => handleSudoDone(currentSudoSessionId, pw)}
                      onDismiss={() => removeInteraction(currentSudoSessionId)}
                    />
                  )}
                  {/* SecretCard — 凭据输入 */}
                  {currentSecret && (
                    <CredentialCard
                      type="secret"
                      title="Secret 请求"
                      description={`环境变量 ${currentSecret.env_var}: ${currentSecret.prompt}`}
                      onSubmit={(v) => handleSecretDone(currentSecretSessionId, v)}
                      onDismiss={() => removeInteraction(currentSecretSessionId)}
                    />
                  )}
                  {/* 🔴 2026-08-17 阶段4：后台会话交互区——per-session 并发轮的
                      审批/澄清/凭据请求必须可见可响应（被单视图过滤丢弃 =
                      工具挂到超时）。每个活跃交互一张卡，带会话身份标签。 */}
                  {backgroundInteractions.length > 0 && (
                    <div className="flex flex-col gap-2 px-3 pt-2">
                      {backgroundInteractions.map(({ sid, it }) => (
                        <div key={sid} className="rounded-lg border border-warning/40 bg-warning/5 p-2">
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-warning">
                            <span className="font-medium">⚡ 后台会话交互 · {shortSessionLabel(sid)}</span>
                            <button
                              className="rounded px-1.5 text-foreground/50 hover:text-foreground"
                              onClick={() => removeInteraction(sid)}
                              title="忽略（会话恢复时经 pending_prompts 重新提示）"
                            >
                              ✕
                            </button>
                          </div>
                          {it.kind === 'approval' && (
                            <ApprovalCard
                              command={it.data.command}
                              description={it.data.description}
                              pattern={it.data.pattern}
                              choices={it.data.choices}
                              run_id={it.data.run_id}
                              onDone={() => handleApprovalDone(sid)}
                            />
                          )}
                          {it.kind === 'clarify' && (
                            <ClarifyCard
                              clarifyId={it.data.clarify_id}
                              question={it.data.question}
                              choices={it.data.choices}
                              multiSelect={it.data.multi_select}
                              onDone={() => handleClarifyDone(sid)}
                            />
                          )}
                          {it.kind === 'clarify_batch' && (
                            <ClarifyBatchCard
                              clarifyId={it.data.clarify_id ?? ''}
                              title={it.data.title}
                              questions={it.data.questions ?? []}
                              onDone={() => handleClarifyDone(sid)}
                            />
                          )}
                          {it.kind === 'sudo' && (
                            <CredentialCard
                              type="sudo"
                              title="Sudo 权限请求"
                              description={it.data.prompt || '需要 sudo 密码'}
                              onSubmit={(pw) => handleSudoDone(sid, pw)}
                              onDismiss={() => removeInteraction(sid)}
                            />
                          )}
                          {it.kind === 'secret' && (
                            <CredentialCard
                              type="secret"
                              title="Secret 请求"
                              description={`环境变量 ${it.data.env_var}: ${it.data.prompt}`}
                              onSubmit={(v) => handleSecretDone(sid, v)}
                              onDismiss={() => removeInteraction(sid)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 🔴 2026-08-18 老大调整：任务计划条（DSH TodoPanel）挂载点
                      从 InputArea 迁到此处——显示在 ContextBar（新建会话/宫格
                      等按钮行）上方；全部任务完成/取消后 TodoPanel 自返 null
                      自动消失（todo 全部完成后不再驻留）。 */}
                  <div className="px-3 pt-2">
                    <TodoPanel sessionId={sess.sessionId} />
                  </div>
                  <ContextBar sessionId={sess.sessionId} sessionStartedAt={sessionStartedAt} onNewSession={handleNewSessionWithScope} viewMode={viewMode} onToggleViewMode={toggleViewMode} agentCount={agentCount} deepseekVisible={deepseekVisible} onToggleDeepSeek={handleToggleDeepSeek} />
                </>
              )}
              <InputArea
                onSend={handleSend}
                onCommand={handleCommand}
                onAbort={handleAbort}
                isStreaming={isStreaming}
                portReady={portReady}
                sessionCwd={sessionCwd}
                onAddImage={handleAddImage}
                onAddImageFromPath={handleAddImageFromPath}
                sessionId={sess.sessionId}
                hasAttachments={attachedImages.length > 0}
              />
            </main>
            </div>
            )}
          </PaneMain>

          {/* 右侧面板：文件浏览器 / 终端 / 预览 / 产物（靠标签切换）
              🔴 终端 + 预览常驻挂载：切 tab 只 CSS hidden——PTY shell 不死（对齐
              Hermes PersistentTerminal "shell 存活于隐藏"）、预览子 webview 不死
              （2026-08-28 对齐修复：旧实现条件渲染 → 切 tab 即 preview_webview_close
              → 切回重建 → 页面状态丢失）；files/artifacts 按需渲染 */}
          <Pane side="right" className="pane-right-column">
            {rightOpen && (
              <>
                <RightSidebarTabs activeTab={rightTab} onTabChange={setRightTab} onClose={() => setRightOpen(false)} />
                {rightTab === 'files' && (
                  <FileBrowserPanel
                    cwd={panelRoot}
                    sessionId={sess.sessionId}
                    onCwdChange={handleFilePanelCwdChange}
                    onFileAttach={(path: string) => requestComposerInsert(`@file:"${path}"`)}
                  />
                )}
                {rightTab === 'artifacts' && (
                  <ArtifactPanel sessionId={sess.sessionId} profile={currentProfile} onSwitchSession={handleSwitchSession} />
                )}
              </>
            )}
            {/* 🔴 预览常驻挂载（2026-08-28 对齐 Hermes + terminal 同款待遇）：
                previewMounted 首次可见才置位 → webview create 有真实坐标尺寸；
                之后 hidden 保活——切 files/terminal/artifacts 再切回，页面状态
                （SPA 路由/表单/滚动）不丢 */}
            {previewMounted && (
              <div className={rightOpen && rightTab === 'preview' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
                <PreviewCenter sessionId={sess.sessionId} cwd={sessionCwd} />
              </div>
            )}
            {/* 🔴 终端挂载（2026-08-09 v2 对齐 Hermes mounted 延迟）：
                terminalMounted 首次可见才置位 → xterm open 时有真实尺寸；
                之后常驻（hidden 时 PTY/快照存活，重开秒恢复）。
                原 be1b8e5 启动即挂载 + display:none → xterm 0×0 open →
                终端空白“什么都没有”（Hermes persistent.tsx 注释明确禁止 0×0 启动） */}
            {terminalMounted && (
              <div className={rightOpen && rightTab === 'terminal' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
                <TerminalPanel cwd={sessionCwd} sessionId={sess.sessionId ?? undefined} />
              </div>
            )}
          </Pane>
        </PaneShell>
        </ErrorBoundary>

        {/* Artifact 预览：右栏「产物」tab（Hermes 右栏语义）；宫格视图浮层在 GridModeView 内挂载 */}

        {overlayPanel === 'settings' && (
          <ErrorBoundary>
            {/* 🔴 2026-08-15 panel 模式：设置 = 点击弹出的居中卡片（左导航+右内容贴紧），无标题栏 */}
            <OverlayView panel onClose={handleCloseOverlay}>
              <SettingsPanel onBack={handleCloseOverlay} currentProfile={currentProfile} />
            </OverlayView>
          </ErrorBoundary>
        )}
        {overlayPanel === 'theme' && (
          <ErrorBoundary>
            <OverlayView onClose={handleCloseOverlay} title="主题">
              <ThemePanel />
            </OverlayView>
          </ErrorBoundary>
        )}
        {overlayPanel === 'about' && (
          <ErrorBoundary>
            <OverlayView onClose={handleCloseOverlay} title="关于">
              <AboutPanel />
            </OverlayView>
          </ErrorBoundary>
        )}

        {/* Model Picker Overlay */}
        {showModelPicker && (
          <ErrorBoundary>
            <OverlayView onClose={handleCloseModelPicker} title="选择模型">
              <ModelPickerPanel
                models={modelDiscovery.models}
                grouped={modelDiscovery.grouped}
                loading={modelDiscovery.loading}
                error={modelDiscovery.error}
                selectedModel={(modelDiscovery.selectedModel || modelName) ?? undefined}
                onSelect={modelDiscovery.selectModel}
                onRefresh={modelDiscovery.refresh}
                onClose={handleCloseModelPicker}
              />
            </OverlayView>
          </ErrorBoundary>
        )}
      </AppShell>

      <ErrorBoundary>
        <CommandCenter
          open={commandCenterOpen}
          onClose={() => setCommandCenterOpen(false)}
          sessions={sess.sessions}
          sessionTitles={sess.titles}
          sessionId={sess.sessionId ?? undefined}
          onSwitchSession={gridAwareSwitchSession}
          onNewSession={gridAwareNewSession}
          onCommand={gridAwareCommand}
          onNavigate={handleNavigate}
        />
      </ErrorBoundary>

      {/* Toast 通知栈 — 顶部居中浮动 */}
      <Toast />

      {/* Agent 编辑面板（双击宫格卡片打开） */}
      {editTarget && (
        <EditAgentDialog
          profile={{
            name: editTarget,
            display_name: displayNames[editTarget] || null,
            color: agentColors[editTarget] || null,
            avatar_key: agentAvatarKeys[editTarget] || null,
          }}
          onClose={() => setEditTarget(null)}
          onSaved={(nick) => {
            // 昵称保存 → App 即时更新 displayNames（状态栏/会话列表立即生效）
            if (nick && nick.trim()) {
              setDisplayNames((prev) => ({ ...prev, [editTarget]: nick.trim() }));
            }
            // 🔴 热更新：重拉 Agent 列表（宫格卡片昵称/颜色即时生效，不依赖重启）
            bumpProfileRefresh();
            void gridRef.current?.refreshProfiles();
          }}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </ModelProvider>
    </ImageEditorContext.Provider>
    </ThemeProvider>
  );
}
