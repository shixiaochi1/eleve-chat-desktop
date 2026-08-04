import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMessageCount, setMessages as storeSetMessages, getMessages } from './store/messages';
import {
  addDebugEvent,
  setDebugToolCalls,
  setMonitor,
  useMonitorModelName,
  useMonitorSessionStartedAt,
} from './store/debug';
import { textPart } from '@/lib/chat-messages';
import { useSessions } from './hooks/useSessions';
import { useGatewayHealth } from './hooks/useGatewayHealth';
import { useMessageStream } from './hooks/useMessageStream';
import { usePromptActions } from './hooks/usePromptActions';
import { useImageAttachments } from './hooks/useImageAttachments';
import { useSessionActions } from './hooks/useSessionActions';
import useModels from './hooks/useModels';
import { useMediaQuery } from './hooks/use-media-query';
import { loadMarkdownDeps } from './utils/markdown';
import * as storage from './utils/storage';
import { loadSettingsFromRust } from './utils/settings-store';
import { discoverPort, call } from './utils/bridge';
import { getActiveProfile, fetchProfiles } from './utils/api';
import { getWsClient, setWsActiveProfile } from './services/ws-client';
import { sessionIdMatchesProfile, profileFromSessionId, persistSessionPointer, clearSessionPointer, loadProfilePointers, saveProfilePointer, removeProfilePointer } from './utils/session';
import type { ChatMessage } from './types';
import { Minus, Square, X } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import CredentialCard from './components/CredentialCard';
import { ThemeProvider } from './themes/index';
import IconBar from './components/IconBar';
import SidePanel from './components/SidePanel';
import OverlayView from './components/OverlayView';
import ThemePanel from './components/ThemePanel';
import SettingsPanel from './components/SettingsPanel';
import AboutPanel from './components/AboutPanel';
import ModelPickerPanel from './components/ModelPickerPanel';
import ToolStatusBar from './components/ToolStatusBar'
import MessageContainer from './components/MessageContainer';
import InputArea from './components/InputArea';
import ContextBar from './components/ContextBar';
import ClarifyCard from './components/ClarifyCard';
import ApprovalCard from './components/ApprovalCard';
import SlashConfirmCard from './components/SlashConfirmCard';
import AppShell from './components/AppShell';
import PaneShell, { Pane, PaneMain, PaneCollapseBtn } from './components/PaneShell';
import FileBrowserPanel from './components/FileBrowserPanel';
import TerminalPanel from './components/TerminalPanel';
import PreviewPanel from './components/PreviewPanel';
import RightSidebarTabs from './components/RightSidebarTabs';
import CommandCenter from './components/CommandCenter';
import Toast from './components/Toast';
import GridModeView, { type GridModeViewHandle } from './components/GridModeView';
import EditAgentDialog from './components/EditAgentDialog';
import { ModelProvider } from './contexts/ModelContext';
import { toggleDeepSeek, hideDeepSeek } from './utils/deepseek-webview';
import { loadDisplaySettings } from './store/display-settings';
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

export default function App() {
  // ── 三栏布局 state ──
  const [activePanel, setActivePanel] = useState<string | null>('agents'); // 默认显示统一侧栏（Agent + 会话）
  const [panelWidth, setPanelWidth] = useState<number>(260);  // 侧边面板宽度（可拖动）

  // ── Responsive: auto-collapse left sidebar when window < 800px ──
  const isNarrow = useMediaQuery('(max-width: 799px)');
  const [responsiveCollapsed, setResponsiveCollapsed] = useState<boolean>(false);
  useEffect(() => {
    if (isNarrow && activePanel) {
      setActivePanel(null);
      setResponsiveCollapsed(true);
    } else if (!isNarrow && responsiveCollapsed) {
      setResponsiveCollapsed(false);
    }
  }, [isNarrow, activePanel, responsiveCollapsed]);

  // ── 右侧文件浏览器 state ──
  const [rightOpen, setRightOpen] = useState<boolean>(false);
  const [rightWidth, setRightWidth] = useState<number>(280);
  const [rightTab, setRightTab] = useState<string>('files'); // 'files' | 'terminal'
  const handleToggleFiles = useCallback(() => setRightOpen(prev => !prev), []);

  const messageCount = useMessageCount();
  const [connectionStatus, setConnectionStatus] = useState<string>('idle');
  const [commandCenterOpen, setCommandCenterOpen] = useState<boolean>(false);
  const [depsReady, setDepsReady] = useState<boolean>(false);
  const [portReady, setPortReady] = useState<boolean>(false); // 需要 discoverPort 后才就绪
  const [storageReady, setStorageReady] = useState<boolean>(false); // 🔴 P0-1: storage.init() 成功后才允许恢复会话
  const [profileResolved, setProfileResolved] = useState<boolean>(false); // 🔴 P0-2: getActiveProfile 完成后才允许恢复会话
  const [sessionListVersion, setSessionListVersion] = useState<number>(0);  // 刷新会话列表
  const [currentProfile, setCurrentProfile] = useState<string>('default');  // F9+ 当前活动 Profile（多 Profile 全局状态）
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');  // 多 Agent 视图模式
  // 🔴 Phase 4b #4: 宫格焦点 Agent 的实时 sessionId（GridModeView 上抛）→ 侧栏会话列表高亮跟随
  const [focusedGridSessionId, setFocusedGridSessionId] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState<number>(1);  // Agent 数量（宫格按钮禁用判断）
  const [deepseekVisible, setDeepseekVisible] = useState<boolean>(false);  // DeepSeek 嵌入 WebView 显隐
  const chatCardRef = useRef<HTMLDivElement>(null);  // DeepSeek WebView 锚点
  const [activeClarify, setActiveClarify] = useState<{ clarify_id: string; question: string; choices: string[] } | null>(null);
  const [activeApproval, setActiveApproval] = useState<{ command: string; description: string; pattern: string; choices: string[]; run_id: string } | null>(null);
  const [activeSudo, setActiveSudo] = useState<{ request_id: string; prompt?: string } | null>(null);
  const [activeSecret, setActiveSecret] = useState<{ request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } | null>(null);
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

  // ── F9+ 多 Profile：启动后拉取当前 active profile（带重试，网关慢启动不静默失败） ──
  useEffect(() => {
    if (!portReady) return;
    let cancelled = false;
    let attempts = 0;
    const tryGetActive = () => {
      getActiveProfile()
        .then((name) => { if (!cancelled) { setWsActiveProfile(name); setCurrentProfile(name); setProfileResolved(true); } })
        .catch(() => {
          // 🔴 决策④：恢复链不再静默失败，重试 5 次（指数退避）
          if (!cancelled && attempts < 5) {
            attempts++;
            setTimeout(tryGetActive, 800 * attempts);
          } else if (!cancelled) {
            // 🔴 P0-2: 重试耗尽也要解锁，否则启动恢复永远阻塞
            // 🔴 P1-5: 记录降级标志，网关恢复后补拉（CLI 设的 active 桌面不跟随）
            profileDegradedRef.current = true;
            setProfileResolved(true);
          }
        });
    };
    tryGetActive();
    return () => { cancelled = true; };
  }, [portReady]);

  // ── 多 Agent UI：Agent 数量（宫格按钮禁用判断）──
  // 初始值：portReady 时拉取（面板可能从未打开，覆盖“启动前已存在多 Agent”）。
  useEffect(() => {
    if (!portReady) return;
    let cancelled = false;
    fetchProfiles()
      .then((data) => { if (!cancelled) setAgentCount(data.profiles.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [portReady]);
  // 🔴 宫格按钮修复：运行期建/删 Agent 由 ProfilePanel 回调驱动（消灭一次性快照平行源）。
  const handleProfilesChange = useCallback((count: number) => setAgentCount(count), []);

  // ── Display 设置：display.show_reasoning（config.yaml per-profile 权威源）──
  // portReady / 切 Agent 时重拉，防止多 Profile 显示设置串台（加载失败回落默认 true）。
  useEffect(() => {
    if (!portReady) return;
    void loadDisplaySettings();
  }, [portReady, currentProfile]);

  // 🔴 昵称全局生效：ProfilePanel 上抛 name → display_name 映射，
  // 状态栏/会话列表显示昵称而非英文 ID（display_name 唯一持有者 = ProfilePanel，App 不重复拉取）。
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const currentProfileLabel = displayNames[currentProfile] || currentProfile;

  // 🔴 颜色全局生效：ProfilePanel 上抛 name → color 映射，
  // 编辑面板初始色/宫格卡片主题色（后端 profile.yaml color 唯一权威源）。
  const [agentColors, setAgentColors] = useState<Record<string, string>>({});
  // 🔴 默认头像 key 全局生效：ProfilePanel 上抛 name → avatar_key（编辑面板初始头像）
  const [agentAvatarKeys, setAgentAvatarKeys] = useState<Record<string, string>>({});
  // 🔴 编辑面板保存后自增 → ProfilePanel/GridModeView 重拉列表（昵称/颜色热更新，不依赖重启）
  const [profileRefreshSignal, setProfileRefreshSignal] = useState(0);
  const bumpProfileRefresh = useCallback(() => setProfileRefreshSignal((t) => t + 1), []);

  // ── Agent 编辑面板（双击宫格卡片打开）──
  const [editTarget, setEditTarget] = useState<string | null>(null);

  // ── 多 Agent UI：Ctrl+G 切换单视图/宫格 ──
  // 🔴 P1-3: grid→single 必须走 handleExitGrid（persistPointers + restoreProfileSession）
  const exitGridRef = useRef<() => void>(() => {});
  const profileDegradedRef = useRef(false); // 🔴 P1-5: getActiveProfile 重试耗尽降级标志
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

  // ── DeepSeek 嵌入 WebView toggle ──
  const handleToggleDeepSeek = useCallback(async () => {
    const anchor = chatCardRef.current;
    console.log('[DeepSeek] toggle clicked, anchor:', anchor ? 'found' : 'NULL');
    if (!anchor) return;
    const nowVisible = await toggleDeepSeek(anchor);
    console.log('[DeepSeek] result:', nowVisible);
    setDeepseekVisible(nowVisible);
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

  // 🔴 W-7: 会话 cwd（session.info 推送）— 传 PreviewPanel 供重启预览使用
  // 会话切换时清空，等新会话的 session.info 重新推送
  const [sessionCwd, setSessionCwd] = useState('');
  useEffect(() => { setSessionCwd(''); }, [sess.sessionId]);

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
  const modelDiscovery = useModels({ enabled: portReady, sessionId: sess.sessionId ?? undefined });

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
    setActiveClarify,
    setActiveApproval,
    setActiveSudo,
    setActiveSecret,
    setActiveSlashConfirm,
    setSessionCwd,
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
    // 🔴 P1-3: 切换会话时清空所有 pending 交互卡片（防 A 的审批卡留在 B 视图）
    setActiveClarify(null); setActiveApproval(null); setActiveSudo(null); setActiveSecret(null); setActiveSlashConfirm(null);
    sess.setSessionId(targetId);
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
    });
  }, [sess, currentSessionIdRef]);

  // 无历史会话 → 空白草稿（单一权威入口；profile = 要清指针的目标 profile）
  const clearSessionView = useCallback((profile: string) => {
    // 🔴 P1-3: 同 loadSessionIntoView
    setActiveClarify(null); setActiveApproval(null); setActiveSudo(null); setActiveSecret(null); setActiveSlashConfirm(null);
    sess.setSessionId(null);
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
  const handleProfileChange = useCallback((name: string) => {
    // 🔴 宫格模式：只切 UI 焦点 + WS 盖章，不做会话保存/恢复（useGridChat 自管 per-agent session）。
    // 侧栏点选 / 宫格点选 都走此路径，currentProfile 是焦点唯一权威源。
    if (viewMode === 'grid') {
      setWsActiveProfile(name);
      setCurrentProfile(name);
      return;
    }

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
    // 🔴 S2: 宫格→单视图同样刷新会话列表（与 handleProfileChange 一致）
    sess.refresh();
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
  const gridAwareNewSession = useCallback(() => {
    if (viewMode === 'grid') {
      gridRef.current?.newSession(currentProfile);
      return;
    }
    handleNewSession();
  }, [viewMode, currentProfile, handleNewSession]);

  // 🔴 P2-6: 宫格模式侧栏“删除会话”路由进宫格（删后自动加载同 Agent 最新剩余会话，无则显示空态）
  const gridAwareDeleteSession = useCallback((id: string) => {
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
  }, [viewMode, handleDeleteSession, sess.sessions]);

  // ── usePromptActions: send/regenerate/abort/queue ──
  const {
    handleSend: rawHandleSend,
    handleAbort,
    handleCommand,
    drainQueue,
    resetSendingLock,
    isSendingRef,
    sendQueueNow,
    deleteQueueEntry,
  } = usePromptActions({
    sess,
    genId,
    setConnectionStatus,
    addDebugEvent,
    setSessionListVersion,
    send,
    abort,
    handleNewSession,
    // 对齐 Hermes: UI 选择的模型传入 session.create（per-session override）
    currentModel: modelDiscovery.selectedModel || modelName || undefined,
    currentProvider: (() => {
      // 从 grouped 反查 selectedModel 的 provider
      const sel = modelDiscovery.selectedModel || modelName;
      if (!sel || !modelDiscovery.grouped) return undefined;
      for (const [pid, group] of Object.entries(modelDiscovery.grouped)) {
        if (group.models?.some((m: any) => m.id === sel)) return pid;
      }
      return undefined;
    })(),
    onSlashConfirm: (data) => setActiveSlashConfirm(data),
    currentProfile,
  });

  // 🔴 P1: 宫格模式 CommandCenter（CMD+K）命令执行路由进宫格（写入 per-agent 状态槽，非不可见的 zustand store）
  const gridAwareCommand = useCallback((cmdName: string, args: string) => {
    if (viewMode === 'grid') {
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
    removeImage,
    clearImages,
    clearError: clearImageError,
    uploadUnuploaded,
  } = useImageAttachments({ getSessionId: () => sess.sessionId });

  // 包装 handleSend — 附件排队归属 + 发送后清空预览
  // 🔴 对齐 Hermes entry 级附件归属：busy 时排队附件 base64 暂存内存 + 从 session 分离
  const handleSend = useCallback(async (text: string) => {
    const wasBusy = isSendingRef.current;
    const images = [...attachedImages];

    // 🔴 新会话图片附件 submit 时序（对齐 Hermes submit.ts: createBackendSessionForSend → syncAttachmentsForSubmit → prompt.submit）
    // 无会话时 addImage 仅本地暂存（uploaded=false）；此处发送前懒创建会话并上传，
    // 保证图片进入后端 session.attached_images，随后 prompt.submit 被后端 drain 消费。
    // 仅直接发送路径（!wasBusy）需要；busy 排队路径由 drain 时附着（会话必然存在）。
    if (!wasBusy && images.some((img) => !img.uploaded)) {
      const ws = getWsClient();
      let sid = sess.sessionId ?? undefined;
      if (!sid) {
        try {
          const created = await ws.sessionCreate({
            profile: currentProfile,
            title: sess.pendingTitle ?? undefined,
          });
          sid = created.session_id;
          sess.setSessionId(sid);
          ws.switchSession(sid);
        } catch (err) {
          console.error('[handleSend] sessionCreate failed, aborting send:', err);
          return; // 对齐 Hermes: 建会话失败 → 中止发送
        }
      }
      const synced = await uploadUnuploaded(sid);
      if (!synced) return; // 对齐 Hermes: 附件同步失败 → 中止发送
    }

    // 准备附件元数据 + base64（排队用）
    const queuedAttachments = images.map((img) => ({
      id: img.id, name: img.name, size: img.size, preview: img.preview,
    }));
    const dataURLs = images.map((img) => img.preview);

    rawHandleSend(text, queuedAttachments.length > 0 ? queuedAttachments : undefined, dataURLs.length > 0 ? dataURLs : undefined);

    if (wasBusy && images.length > 0) {
      // 排队场景：从 session 分离图片（防下次发送误消费）+ 清本地状态
      // 🔴 显式传 sessionId（禁止 fallback 到 ws-client 全局，profile 切换瞬间全局可能是目标 Agent）
      const ws = getWsClient();
      const sid = sess.sessionId ?? undefined;
      for (const img of images) {
        // 仅分离已上传到后端的图片（本地暂存的无后端状态）
        if (img.uploaded && img.path) ws.imageDetach(img.path, sid).catch(() => {});
      }
    }
    // 发送/排队后都清本地预览（后端 prompt.submit 自动 drain / 排队已暂存）
    if (images.length > 0) {
      clearImages();
    }
  }, [rawHandleSend, attachedImages, clearImages, isSendingRef, sess.sessionId, sess, currentProfile, uploadUnuploaded]);

  // 适配 addImage 签名：useImageAttachments 返回 Promise<AttachedImage | null>，
  // InputArea 的 onAddImage 期望 Promise<void>，丢弃返回值即可
  const handleAddImage = useCallback(async (file: File): Promise<void> => {
    await addImage(file);
  }, [addImage]);

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

  // ── load markdown deps + init port + init theme on mount ──
  // 🔴 P0-1: 会话恢复统一由 startupRestored effect 处理（含 sessionIdMatchesProfile 校验）。
  // mount 只预加载 cache/titles（无害），不设 sessionId、不加载消息。
  useEffect(() => {
    // 初始化主题（纯同步，立即执行）
    const savedTheme = (() => {
      try {
        const ft = storage.load('theme') as string | null;
        if (ft) return ft;
        const ls = localStorage.getItem('eleve-theme');
        if (ls) {
          storage.save('theme', ls);
          localStorage.removeItem('eleve-theme');
          return ls;
        }
      } catch { /* ignore */ }
      return null;
    })();
    if (savedTheme) {
      document.documentElement.dataset.theme = savedTheme;
    }

    // 🔴 P1：loadSettingsFromRust 已移至 WS connect 后（下方 portReady effect）。
    // 旧实现在 mount 时调（WS 未连，sendRpc state='disconnected' 必 reject，无重试）→ 死代码。
    loadMarkdownDeps().then(() => setDepsReady(true));

    if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
      const portPromise = discoverPort();

      // 🔴 P0-1: 只预加载 cache/titles，不设 sessionId、不加载消息
      // 冷启动时 WS 未连，init() 会失败（不置 _initialized），WS onOpen 后重试
      storage.init().then(async () => {
        if (!storage.isReady()) return; // WS 未连接时 init 失败，等 onOpen 重试
        setStorageReady(true);
        const restoredCache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        const restoredTitles = storage.load('titles', {} as Record<string, string>) as Record<string, string>;
        if (Object.keys(restoredCache).length > 0 && Object.keys(sess.msgCache).length === 0) {
          sess.saveCache(() => restoredCache);
        }
        if (Object.keys(restoredTitles).length > 0 && Object.keys(sess.titles).length === 0) {
          sess.saveTitles(() => restoredTitles);
        }
      });

      // 端口发现 → portReady（会话恢复由 startupRestored effect 统一处理）
      // 🔴 P1-2: 失败后定时重试，不再永久死局
      const tryDiscover = (attempt: number) => {
        discoverPort().then((ok) => {
          if (ok) {
            setPortReady(true);
          } else if (attempt < 10) {
            console.warn(`[App] Gateway port discovery failed, retry ${attempt + 1}/10`);
            setTimeout(() => tryDiscover(attempt + 1), 2000 * (attempt + 1));
          } else {
            setConnectionStatus('error');
            console.error('[App] Gateway port discovery failed after 10 attempts');
          }
        });
      };
      tryDiscover(0);
    } else {
      setPortReady(true);
      // 🔴 P0-1: 同 Tauri 分支，只预加载 cache/titles
      storage.init().then(async () => {
        if (!storage.isReady()) return;
        setStorageReady(true);
        const restoredCache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        const restoredTitles = storage.load('titles', {} as Record<string, string>) as Record<string, string>;
        if (Object.keys(restoredCache).length > 0 && Object.keys(sess.msgCache).length === 0) {
          sess.saveCache(() => restoredCache);
        }
        if (Object.keys(restoredTitles).length > 0 && Object.keys(sess.titles).length === 0) {
          sess.saveTitles(() => restoredTitles);
        }
      });
    }
  }, []);  // ← 只执行一次，不依赖 messages 或 sessionId

  // ── WebSocket 连接管理 ──
  // 对齐 Hermes Desktop: WS 连接不依赖 session_id
  // Hermes Desktop: boot() 时立即连 WS，session 通过 RPC 管理
  // portReady 后立即建立 WS 连接，sessionId 后续通过 prompt.submit 传
  useEffect(() => {
    if (!portReady) return;

    const wsClient = getWsClient();
    if (wsClient.state === 'disconnected') {
      console.log('[App] Initiating WS connection (align Hermes: no session_id in URL)');
      wsClient.connect(undefined, {
        onOpen: () => {
          console.log('[App] WS connected');
          // 🔴 P1-1: 冷启动时 useSessions.refresh 在 WS 未连时静默失败，连接建立后补刷
          sess.refresh();
          // 🔴 P0-1: 冷启动 storage.init() 在 WS 未连时必然失败，连接后重试加载持久化数据
          storage.init().then(() => {
            if (storage.isReady()) setStorageReady(true);
          });
        },
        onClose: (code, reason) => console.log('[App] WS closed:', code, reason),
        onError: (err) => console.error('[App] WS error:', err),
      });
      // P1 修复：settings RPC 在 WS 连接发起后调用 — connecting 期间 sendRpc
      // 排队等待，连接建立后冲刷。幂等，仅首连分支调（sessionId 变化不重复）。
      loadSettingsFromRust();
    } else if (wsClient.state === 'connected' && sess.sessionId) {
      // WS 已连、session 变化 → 更新 wsClient 的 sessionId（不重连）
      wsClient.sessionId = sess.sessionId;
    }

    return () => {
      // App unmount 时不 disconnect，WS 长连接跨组件
    };
  }, [portReady, sess.sessionId]);

  // ── beforeunload: 用 ref 拿最新 messages，避免依赖 [messages] 导致白屏 ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sid = storage.load('session_id') as string | null;
      if (sid) {
        const cache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        cache[sid] = getMessages();
        storage.saveBeacon('msg_cache', cache);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── clarify done ──
  const handleClarifyDone = useCallback(() => {
    setActiveClarify(null);
  }, []);

  // ── approval done ──
  const handleApprovalDone = useCallback(() => {
    setActiveApproval(null);
  }, []);

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

  // ── sudo done (TODO: implement dialog response) ──
  const handleSudoDone = useCallback(async (password: string) => {
    if (!activeSudo) return;
    try {
      await call('sudo_respond', { request_id: activeSudo.request_id, password });
    } catch { /* 静默处理 */ }
    setActiveSudo(null);
  }, [activeSudo]);

  // ── secret done
  const handleSecretDone = useCallback(async (value: string) => {
    if (!activeSecret) return;
    try {
      await call('secret_respond', { request_id: activeSecret.request_id, value });
    } catch { /* 静默处理 */ }
    setActiveSecret(null);
  }, [activeSecret]);

  // ── command center navigation ──
  const handleNavigate = useCallback((panel: string) => {
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
      if (mod && e.key === 'w') { e.preventDefault(); tauriWindow?.close(); }
      if (mod && e.key === 'l') { e.preventDefault(); (document.getElementById('input') as HTMLElement)?.focus(); }
      if (mod && e.key === 'k') { e.preventDefault(); setCommandCenterOpen((v) => !v); }
      if (e.key === 'Escape') {
        if ((document.activeElement as HTMLElement)?.id === 'input') (document.activeElement as HTMLElement).blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [gridAwareNewSession]);

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
          onLeftResize={(w: number) => setPanelWidth(Math.max(180, Math.min(500, w - 52)))}
          onLeftToggle={() => setActivePanel(activePanel ? null : 'agents')}
          minLeftWidth={180}
          maxLeftWidth={500}
          rightOpen={rightOpen}
          rightWidth={`${rightWidth}px`}
          onRightResize={(w: number) => setRightWidth(Math.max(200, Math.min(400, w)))}
          onRightToggle={handleToggleFiles}
          minRightWidth={200}
          maxRightWidth={400}
          className="app-pane-shell"
        >
          {/* 左侧面板：图标栏 + 侧边面板卡片 */}
          <Pane side="left" className="pane-left-column">
            <IconBar activePanel={activePanel} onPanelChange={setActivePanel} onOpenOverlay={handleOpenOverlay} gatewayOnline={gatewayHealth.online} onToggleFiles={handleToggleFiles} />
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
                  onFocusedSessionChange={setFocusedGridSessionId}
                  portReady={portReady}
                  onNewSessionEffects={handleGridNewSessionEffects}
                />
              </div>
            ) : (
            <div className="chat-card" ref={chatCardRef}>
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
            <main className="chat-area" id="page-chat">
              <ToolStatusBar sessionId={sess.sessionId} isStreaming={isStreaming} onToggleViewMode={toggleViewMode} />
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
                  />
                  {activeClarify && (
                    <ClarifyCard
                      clarifyId={activeClarify.clarify_id}
                      question={activeClarify.question}
                      choices={activeClarify.choices}
                      onDone={handleClarifyDone}
                    />
                  )}
                  {activeApproval && (
                    <ApprovalCard
                      command={activeApproval.command}
                      description={activeApproval.description}
                      pattern={activeApproval.pattern}
                      choices={activeApproval.choices}
                      run_id={activeApproval.run_id}
                      onDone={handleApprovalDone}
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
                  {activeSudo && (
                    <CredentialCard
                      type="sudo"
                      title="Sudo 权限请求"
                      description={activeSudo.prompt || '需要 sudo 密码'}
                      onSubmit={handleSudoDone}
                      onDismiss={() => setActiveSudo(null)}
                    />
                  )}
                  {/* SecretCard — 凭据输入 */}
                  {activeSecret && (
                    <CredentialCard
                      type="secret"
                      title="Secret 请求"
                      description={`环境变量 ${activeSecret.env_var}: ${activeSecret.prompt}`}
                      onSubmit={handleSecretDone}
                      onDismiss={() => setActiveSecret(null)}
                    />
                  )}
                  <ContextBar sessionId={sess.sessionId} sessionStartedAt={sessionStartedAt} onNewSession={handleNewSession} viewMode={viewMode} onToggleViewMode={toggleViewMode} agentCount={agentCount} deepseekVisible={deepseekVisible} onToggleDeepSeek={handleToggleDeepSeek} />
                </>
              )}
              <InputArea
                onSend={handleSend}
                onCommand={handleCommand}
                onAbort={handleAbort}
                isStreaming={isStreaming}
                portReady={portReady}
                sessionCwd={sessionCwd}
                attachedImages={attachedImages}
                imageUploading={imageUploading}
                imageError={imageError}
                onAddImage={handleAddImage}
                onRemoveImage={handleRemoveImage}
                onClearImageError={clearImageError}
                queueProfile={currentProfile}
                onQueueSendNow={sendQueueNow}
                onQueueDelete={deleteQueueEntry}
              />
            </main>
            </div>
            )}
          </PaneMain>

          {/* 右侧面板：文件浏览器 / 终端 / 预览 (靠标签切换) — 只在 rightOpen 时渲染子元素，避免 TerminalPanel 在 0 宽容器中初始化 xterm.js */}
          <Pane side="right" className="pane-right-column">
            {rightOpen && <RightSidebarTabs activeTab={rightTab} onTabChange={setRightTab} />}
            {rightOpen && (rightTab === 'files' ? (
              <FileBrowserPanel onFileAttach={(path: string) => handleSend(`@file:"${path}"`)} />
            ) : rightTab === 'preview' ? (
              <PreviewPanel sessionId={sess.sessionId} cwd={sessionCwd} />
            ) : (
              <TerminalPanel onSend={handleSend} isStreaming={isStreaming} sessionId={sess.sessionId ?? undefined} />
            ))}
          </Pane>
        </PaneShell>
        </ErrorBoundary>

        {overlayPanel === 'settings' && (
          <ErrorBoundary>
            <OverlayView onClose={handleCloseOverlay} title="设置">
              <SettingsPanel onBack={handleCloseOverlay} currentProfile={currentProfile} />
            </OverlayView>
          </ErrorBoundary>
        )}
        {overlayPanel === 'theme' && (
          <ErrorBoundary>
            <OverlayView onClose={handleCloseOverlay} title="主题">
              <ThemePanel onClose={handleCloseOverlay} />
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
    </ThemeProvider>
  );
}
