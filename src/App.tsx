import { useState, useEffect, useRef, useCallback } from 'react';
import { useMessages, setMessages as storeSetMessages, getMessages } from './store/messages';
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
import { sessionIdMatchesProfile, profileFromSessionId } from './utils/session';
import type { ChatMessage } from './types';
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
import GridModeView from './components/GridModeView';
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

export default function App() {
  // ── 三栏布局 state ──
  const [activePanel, setActivePanel] = useState<string | null>('sessions'); // 默认显示会话列表
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

  const messages = useMessages();
  const [connectionStatus, setConnectionStatus] = useState<string>('idle');
  const [commandCenterOpen, setCommandCenterOpen] = useState<boolean>(false);
  const [depsReady, setDepsReady] = useState<boolean>(false);
  const [portReady, setPortReady] = useState<boolean>(false); // 需要 discoverPort 后才就绪
  const [sessionListVersion, setSessionListVersion] = useState<number>(0);  // 刷新会话列表
  const [currentProfile, setCurrentProfile] = useState<string>('default');  // F9+ 当前活动 Profile（多 Profile 全局状态）
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');  // 多 Agent 视图模式
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

  // ── F9+ 多 Profile：启动后拉取当前 active profile（带重试，网关慢启动不静默失败） ──
  useEffect(() => {
    if (!portReady) return;
    let cancelled = false;
    let attempts = 0;
    const tryGetActive = () => {
      getActiveProfile()
        .then((name) => { if (!cancelled) { setWsActiveProfile(name); setCurrentProfile(name); } })
        .catch(() => {
          // 🔴 决策④：恢复链不再静默失败，重试 5 次（指数退避）
          if (!cancelled && attempts < 5) {
            attempts++;
            setTimeout(tryGetActive, 800 * attempts);
          }
        });
    };
    tryGetActive();
    return () => { cancelled = true; };
  }, [portReady]);

  // ── 多 Agent UI：拉取 Agent 数量（宫格按钮禁用判断）──
  useEffect(() => {
    if (!portReady) return;
    let cancelled = false;
    fetchProfiles()
      .then((data) => { if (!cancelled) setAgentCount(data.profiles.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [portReady]);

  // ── 多 Agent UI：Ctrl+G 切换单视图/宫格 ──
  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === 'single' ? 'grid' : 'single';
      if (next === 'grid') hideDeepSeek().then(() => setDeepseekVisible(false));
      return next;
    });
  }, []);

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

  // 🔴 D1 修复：切换 profile 时刷新会话列表（session.list 后端按 params.profile 过滤）
  useEffect(() => {
    sess.refresh();
  }, [currentProfile]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!portReady || startupRestored.current) return;
    startupRestored.current = true;
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    // 🔴 串台防御：map 指针或全局 fallback 可能指向其他 profile 的 session，校验后才恢复
    const rawTarget = map[currentProfile] || (storage.load('session_id', null) as string | null);
    const targetId = rawTarget && sessionIdMatchesProfile(rawTarget, currentProfile) ? rawTarget : null;
    if (targetId) {
      sess.setSessionId(targetId);
      getWsClient().switchSession(targetId);
      sess.loadHistory(targetId).then((msgs) => {
        if (msgs?.length) storeSetMessages(msgs as ChatMessage[]);
      });
    }
  }, [portReady, currentProfile, sess]); // eslint-disable-line react-hooks/exhaustive-deps

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
    onOnline: () => { if (connectionStatus === 'error') setConnectionStatus('idle'); },
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

  // ── debug / monitoring state ──
  interface DebugInfo {
    sessionId: string;
    tokensIn: number;
    tokensOut: number;
    lastSent: string;
    sessionStartedAt: number | null;
  }
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({ sessionId: '', tokensIn: 0, tokensOut: 0, lastSent: '(none)', sessionStartedAt: null });
  const [monitorState, setMonitorState] = useState<{ modelName: string | null; delegateTasks: Record<string, any>; tokensIn?: number; tokensOut?: number; lastSent?: string; sessionStartedAt?: number | null; statusText?: string }>({ modelName: null, delegateTasks: {} });
  const [debugEvents, setDebugEvents] = useState<Array<{ ts: number; type: string; detail: string }>>([]);
  const [debugToolCalls, setDebugToolCalls] = useState<any[]>([]);

  const addDebugEvent = useCallback((type: string, detail: string) => {
    setDebugEvents((prev) => {
      const next = [...prev, { ts: Date.now(), type, detail }];
      return next.length > 200 ? next.slice(-150) : next;
    });
  }, []);

  // ── drain queue ref (wired after usePromptActions) ──
  const drainQueueRef = useRef<any>(null);

  // ── useMessageStream: SSE callbacks + throttle + useSSE ──
  const {
    isStreaming,
    send,
    abort,
    resetStream,
  } = useMessageStream({
    genId,
    addDebugEvent,
    setConnectionStatus,
    setDebugInfo,
    setDebugToolCalls,
    setMonitorState,
    setActiveClarify,
    setActiveApproval,
    setActiveSudo,
    setActiveSecret,
    sess,
    drainQueueRef,
    setSessionListVersion,
    enabled: viewMode === 'single',  // 🔴 宫格模式暂停 useSSE，useGridChat 接管 WS 事件
  });

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
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    // 🔴 串台防御：只写入归属正确的 session 指针，防止污染扩散
    if (sess.sessionId && sessionIdMatchesProfile(sess.sessionId, currentProfile)) {
      map[currentProfile] = sess.sessionId;
    }
    storage.save('profile_session_map', map);

    // ── Step 2: 重置流式状态（清流式指示器 + 累加器 + streamId） ──
    resetStream();

    // ── Step 3: 切换盖章（同步，保证后续 sendRpc 盖章正确） ──
    setWsActiveProfile(name);
    setCurrentProfile(name);

    // ── Step 3b: 🔴 S2 修复 — 刷新会话列表（后端按 profile 过滤，S1 保证 sendRpc 盖章新 profile） ──
    sess.refresh();

    // ── Step 4: 恢复目标会话（后端是权威源，始终 loadHistory） ──
    // 🔴 串台防御：map 指针可能被历史污染，校验归属后才恢复
    const rawTargetId = map[name] || null;
    const targetId = rawTargetId && sessionIdMatchesProfile(rawTargetId, name) ? rawTargetId : null;
    if (targetId) {
      sess.setSessionId(targetId);
      storage.save('session_id', targetId);
      sess.setFreshDraftReady(false);
      getWsClient().switchSession(targetId);
      // 缓存秒显（纯 UX 防白屏，始终被后端数据覆盖）
      const cached = sess.msgCache[targetId];
      storeSetMessages(cached?.length ? (cached as ChatMessage[]) : []);
      // 🔴 始终从后端加载完整历史（含离开期间的消息）
      sess.loadHistory(targetId).then((msgs) => {
        if (msgs?.length) {
          storeSetMessages(msgs as ChatMessage[]);
          sess.saveCache((c) => ({ ...c, [targetId]: msgs }));
        }
      });
      // 🔴 恢复 pending 交互弹窗（切走时 approval/clarify/sudo 被 WS 过滤丢弃，切回需重建）
      call('session.info', { session_id: targetId }).then((info: any) => {
        const pp = info?.pending_prompts;
        if (!pp) return;
        if (pp.approval) setActiveApproval(pp.approval);
        if (pp.clarify) setActiveClarify(pp.clarify);
        if (pp.sudo_password) setActiveSudo({ request_id: pp.sudo_password.sudo_id, prompt: pp.sudo_password.prompt });
        if (pp.secret_capture) setActiveSecret(pp.secret_capture);
      }).catch(() => { /* session.info 不可用时静默 */ });
    } else {
      // 无历史会话 → 空白草稿
      sess.setSessionId(null);
      storage.save('session_id', null);
      sess.setFreshDraftReady(true);
      getWsClient().switchSession('');
      storeSetMessages([]);
    }
  }, [sess, currentProfile, resetStream, viewMode]);

  // 🔴 宫格→单视图：恢复目标 profile 的会话。
  // 宫格退出/展开前已由 GridModeView.persistPointers 把各 Agent 最新 session 指针写回
  // profile_session_map，故此处只从 map 读取 + 后端重加载。与 handleProfileChange 的区别：
  // 不回写“切走”会话（避免用陈旧的全局 sess.sessionId 覆盖宫格刚写回的权威指针）。
  const restoreProfileSession = useCallback((profile: string) => {
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    const targetId = map[profile] || null;
    resetStream();
    setWsActiveProfile(profile);
    setCurrentProfile(profile);
    // 🔴 S2: 宫格→单视图同样刷新会话列表（与 handleProfileChange 一致）
    sess.refresh();
    if (targetId) {
      sess.setSessionId(targetId);
      storage.save('session_id', targetId);
      sess.setFreshDraftReady(false);
      getWsClient().switchSession(targetId);
      const cached = sess.msgCache[targetId];
      storeSetMessages(cached?.length ? (cached as ChatMessage[]) : []);
      sess.loadHistory(targetId).then((msgs) => {
        if (msgs?.length) {
          storeSetMessages(msgs as ChatMessage[]);
          sess.saveCache((c) => ({ ...c, [targetId]: msgs }));
        }
      });
      // 恢复 pending 交互弹窗（与 handleProfileChange 一致）
      call('session.info', { session_id: targetId }).then((info: any) => {
        const pp = info?.pending_prompts;
        if (!pp) return;
        if (pp.approval) setActiveApproval(pp.approval);
        if (pp.clarify) setActiveClarify(pp.clarify);
        if (pp.sudo_password) setActiveSudo({ request_id: pp.sudo_password.sudo_id, prompt: pp.sudo_password.prompt });
        if (pp.secret_capture) setActiveSecret(pp.secret_capture);
      }).catch(() => { /* session.info 不可用时静默 */ });
    } else {
      sess.setSessionId(null);
      storage.save('session_id', null);
      sess.setFreshDraftReady(true);
      getWsClient().switchSession('');
      storeSetMessages([]);
    }
  }, [sess, resetStream]);

  // 退出宫格（回到当前 profile 单视图）
  const handleExitGrid = useCallback(() => {
    setViewMode('single');
    restoreProfileSession(currentProfile);
  }, [restoreProfileSession, currentProfile]);

  // 展开某个 Agent 为单视图
  const handleExpandAgent = useCallback((profile: string) => {
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
    setDebugInfo: setDebugInfo as any,
    setSessionListVersion,
    resetSendingLock: undefined, // will be wired after usePromptActions
    resetStream,
  });

  // 🔴 宫格模式：点击会话列表 → 解析 session 归属 Agent → 展开为单视图 + 加载该会话。
  // 单视图模式：透传原始 handleSwitchSession。
  const gridAwareSwitchSession = useCallback((id: string) => {
    if (viewMode === 'grid') {
      const profile = profileFromSessionId(id) || currentProfile;
      setWsActiveProfile(profile);
      setCurrentProfile(profile);
      setViewMode('single');
    }
    handleSwitchSession(id);
  }, [viewMode, currentProfile, handleSwitchSession]);

  // ── usePromptActions: send/regenerate/abort/queue ──
  const {
    handleSend: rawHandleSend,
    handleAbort,
    handleCommand,
    drainQueue,
    resetSendingLock,
  } = usePromptActions({
    sess,
    genId,
    setConnectionStatus,
    setDebugInfo: setDebugInfo as any,
    addDebugEvent,
    setSessionListVersion,
    send,
    abort,
    handleNewSession,
    // 对齐 Hermes: UI 选择的模型传入 session.create（per-session override）
    currentModel: modelDiscovery.selectedModel || monitorState.modelName || undefined,
    currentProvider: (() => {
      // 从 grouped 反查 selectedModel 的 provider
      const sel = modelDiscovery.selectedModel || monitorState.modelName;
      if (!sel || !modelDiscovery.grouped) return undefined;
      for (const [pid, group] of Object.entries(modelDiscovery.grouped)) {
        if (group.models?.some((m: any) => m.id === sel)) return pid;
      }
      return undefined;
    })(),
    onSlashConfirm: (data) => setActiveSlashConfirm(data),
  });

  // ── 临时提问模式 (/btw) — 内联模式条，替代 window.prompt ──
  // 进入模式后输入区顶部显示紫色状态条，发送走 handleCommand('btw', text)，
  // 不写入会话上下文、不使用工具；Esc 或发送后自动退出
  const [btwMode, setBtwMode] = useState(false);
  const enterBtwMode = useCallback(() => setBtwMode(true), []);
  const exitBtwMode = useCallback(() => setBtwMode(false), []);
  const handleBtwSend = useCallback((text: string) => {
    void handleCommand('btw', text);
  }, [handleCommand]);

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
  } = useImageAttachments();

  // 包装 handleSend — 发送成功后清空图片预览
  // 注意：drainQueue 内部调用的是 rawHandleSend 的底层 send()，不经过此包装
  // drainQueue 是排队消息发送，不涉及图片附件，所以不需要 clearImages
  const handleSend = useCallback((text: string) => {
    rawHandleSend(text);
    // 发送后清空图片（后端 prompt.submit 会自动 drain 消费）
    if (attachedImages.length > 0) {
      clearImages();
    }
  }, [rawHandleSend, attachedImages.length, clearImages]);

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

  // ── load markdown deps + init port + init theme + restore session on mount ──
  const messagesInitDone = useRef<boolean>(false);
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

      storage.init().then(async () => {
        const restoredId = storage.load('session_id', null) as string | null;
        if (restoredId && restoredId !== sess.sessionId) {
          sess.setSessionId(restoredId);
        }
        const restoredCache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        const restoredTitles = storage.load('titles', {} as Record<string, string>) as Record<string, string>;
        if (Object.keys(restoredCache).length > 0 && Object.keys(sess.msgCache).length === 0) {
          sess.saveCache(() => restoredCache);
        }
        if (Object.keys(restoredTitles).length > 0 && Object.keys(sess.titles).length === 0) {
          sess.saveTitles(() => restoredTitles);
        }
        if (restoredId && !messagesInitDone.current) {
          messagesInitDone.current = true;
          const cached = restoredCache[restoredId];
          if (cached?.length) {
            storeSetMessages(cached);
            setDebugInfo((prev: DebugInfo) => ({ ...prev, sessionId: restoredId as string, sessionStartedAt: Date.now() }));
          }
        }
      });

      // 🔴 修复竞态
      Promise.all([portPromise, storage.init()]).then(([ok]) => {
        if (ok) {
          setPortReady(true);
        } else {
          setConnectionStatus('error');
          console.error('[App] Gateway port discovery failed');
          return; // port 失败则不尝试加载
        }
        const restoredId = sess.sessionId;
        if (restoredId && getMessages().length === 0) {
          sess.loadHistory(restoredId).then((msgs: ChatMessage[] | null) => {
            if (msgs?.length) {
              storeSetMessages(msgs);
              sess.saveCache((cache: Record<string, ChatMessage[]>) => ({ ...cache, [restoredId]: msgs }));
              setDebugInfo((prev: DebugInfo) => ({ ...prev, sessionId: restoredId, sessionStartedAt: Date.now() }));
            }
          });
        }
      });
    } else {
      setPortReady(true);
      storage.init().then(async () => {
        const restoredId = storage.load('session_id', null) as string | null;
        if (restoredId && restoredId !== sess.sessionId) {
          sess.setSessionId(restoredId);
        }
        const restoredCache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        const restoredTitles = storage.load('titles', {} as Record<string, string>) as Record<string, string>;
        if (Object.keys(restoredCache).length > 0 && Object.keys(sess.msgCache).length === 0) {
          sess.saveCache(() => restoredCache);
        }
        if (Object.keys(restoredTitles).length > 0 && Object.keys(sess.titles).length === 0) {
          sess.saveTitles(() => restoredTitles);
        }
        if (restoredId && !messagesInitDone.current) {
          messagesInitDone.current = true;
          const cached = restoredCache[restoredId];
          if (cached?.length) {
            storeSetMessages(cached);
            setDebugInfo((prev: DebugInfo) => ({ ...prev, sessionId: restoredId as string, sessionStartedAt: Date.now() }));
          }
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
        onOpen: () => console.log('[App] WS connected'),
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
      storage.save('session_id', newSid);
      sess.refresh();
      setDebugInfo((prev) => ({ ...prev, sessionId: newSid, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
      storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
    } else {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
    }
  }, [sess, genId, setDebugInfo, setSessionListVersion]);

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
      const { call } = await import('./utils/bridge');
      await call('restart_service', {});
    } catch (err) {
      console.error('Restart failed:', err);
    }
  }, []);

  // ── keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') { e.preventDefault(); handleNewSession(); }
      if (mod && e.key === 'w') { e.preventDefault(); tauriWindow?.close(); }
      if (mod && e.key === 'l') { e.preventDefault(); (document.getElementById('input') as HTMLElement)?.focus(); }
      if (mod && e.key === 'k') { e.preventDefault(); setCommandCenterOpen((v) => !v); }
      if (e.key === 'Escape') {
        if ((document.activeElement as HTMLElement)?.id === 'input') (document.activeElement as HTMLElement).blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleNewSession]);

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
    <div className="titlebar" data-tauri-drag-region onDoubleClick={winMax}>
      <span className="titlebar-logo"><img src="/Elogo.svg" alt="Eleve" className="titlebar-logo-img" /> Eleve Chat</span>
      <div className="titlebar-actions">
        <button className="tb-btn" id="btn-min" title="最小化" onClick={winMin}>─</button>
        <button className="tb-btn" id="btn-max" title="最大化" onClick={winMax}>□</button>
        <button className="tb-btn tb-btn-close" id="btn-close" title="关闭" onClick={winClose}>✕</button>
      </div>
    </div>
  );

  return (
    <ThemeProvider>
      <AppShell
        titlebar={titlebarEl}
        connectionStatus={connectionStatus}
        gatewayOnline={gatewayHealth.online}
        gatewayChecking={gatewayHealth.checking}
        sessionId={debugInfo.sessionId}
        modelName={modelDiscovery.selectedModel || monitorState.modelName || undefined}
        profileName={currentProfile}
        tokensIn={debugInfo.tokensIn}
        tokensOut={debugInfo.tokensOut}
        onOpenSettings={() => handleOpenOverlay('settings')}
      >
        {/* ===== PaneShell 三栏布局：图标栏 + 侧边面板 + 聊天区 ===== */}
        <ErrorBoundary>
        <PaneShell
          leftOpen={true}
          leftWidth={activePanel ? `${52 + panelWidth}px` : '52px'}
          onLeftResize={(w: number) => setPanelWidth(Math.max(180, Math.min(500, w - 52)))}
          onLeftToggle={() => setActivePanel(activePanel ? null : 'sessions')}
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
                  currentProfile={currentProfile}
                  onProfileChange={handleProfileChange}
                  onOpenSettings={() => handleOpenOverlay('settings')}
                  onRestart={handleRestartService}
                  sessionId={sess.sessionId}
                  sessions={sess.sessions}
                  onSwitchSession={gridAwareSwitchSession}
                  onDeleteSession={handleDeleteSession}
                  sessionTitles={sess.titles}
                  onNewSession={handleNewSession}
                  connectionStatus={connectionStatus}
                  isStreaming={isStreaming}
                  gatewayOnline={gatewayHealth.online}
                  gatewayChecking={gatewayHealth.checking}
                  onGatewayRetry={gatewayHealth.checkNow}
                  onAbort={handleAbort}
                  sessionListVersion={sessionListVersion}
                  debugEvents={debugEvents}
                  debugToolCalls={debugToolCalls}
                  messageCount={messages.length}
                  tokensIn={debugInfo.tokensIn}
                  tokensOut={debugInfo.tokensOut}
                  messages={messages}
                />
            </div>
            )}
          </Pane>

          {/* 右侧聊天主区域 */}
          <PaneMain>
            {viewMode === 'grid' ? (
              <div className="chat-card">
                <GridModeView
                  currentProfile={currentProfile}
                  currentSessionId={sess.sessionId}
                  onExitGrid={handleExitGrid}
                  onExpandAgent={handleExpandAgent}
                  onFocusChange={handleProfileChange}
                  portReady={portReady}
                  currentModel={modelDiscovery.selectedModel || monitorState.modelName || undefined}
                  modelGrouped={modelDiscovery.grouped}
                  modelLoading={modelDiscovery.loading}
                  modelError={modelDiscovery.error}
                  onSelectModel={modelDiscovery.selectModel}
                  onOpenSettings={() => handleOpenOverlay('settings')}
                  onRefreshModels={() => modelDiscovery.refresh(true)}
                />
              </div>
            ) : (
            <div className="chat-card" ref={chatCardRef}>
            {responsiveCollapsed && (
              <button
                className="absolute top-2 left-2 z-20 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
                aria-label="Expand sidebar"
                title="展开侧边面板"
                onClick={() => setActivePanel('sessions')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <main className="chat-area" id="page-chat">
              <ToolStatusBar sessionId={sess.sessionId} isStreaming={isStreaming} />
              {!portReady && messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                  <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 14 }}>正在连接 Agent...</p>
                </div>
              ) : (
                <>
                  <MessageContainer
                    gatewayOnline={gatewayHealth.online}
                    onGatewayRetry={gatewayHealth.checkNow}
                    onOpenSettings={() => handleOpenOverlay('settings')}
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
                  <ContextBar sessionId={sess.sessionId} sessionStartedAt={debugInfo.sessionStartedAt} onNewSession={handleNewSession} onBtw={enterBtwMode} viewMode={viewMode} onToggleViewMode={toggleViewMode} agentCount={agentCount} deepseekVisible={deepseekVisible} onToggleDeepSeek={handleToggleDeepSeek} />
                </>
              )}
              <InputArea
                onSend={handleSend}
                onCommand={handleCommand}
                onAbort={handleAbort}
                isStreaming={isStreaming}
                portReady={portReady}
                attachedImages={attachedImages}
                imageUploading={imageUploading}
                imageError={imageError}
                onAddImage={handleAddImage}
                onRemoveImage={handleRemoveImage}
                onClearImageError={clearImageError}
                currentModel={modelDiscovery.selectedModel || monitorState.modelName || undefined}
                modelGrouped={modelDiscovery.grouped}
                modelLoading={modelDiscovery.loading}
                modelError={modelDiscovery.error}
                onSelectModel={modelDiscovery.selectModel}
                onOpenSettings={() => handleOpenOverlay('settings')}
                onRefreshModels={() => modelDiscovery.refresh(true)}
                btwMode={btwMode}
                onBtwSend={handleBtwSend}
                onBtwExit={exitBtwMode}
              />
            </main>
            </div>
            )}
          </PaneMain>

          {/* 右侧面板：文件浏览器 / 终端 / 预览 (靠标签切换) — 只在 rightOpen 时渲染子元素，避免 TerminalPanel 在 0 宽容器中初始化 xterm.js */}
          <Pane side="right" className="pane-right-column">
            {rightOpen && <RightSidebarTabs activeTab={rightTab} onTabChange={setRightTab} />}
            {rightOpen && (rightTab === 'files' ? (
              <FileBrowserPanel onFileAttach={(path: string) => handleSend(`/file ${path}`)} />
            ) : rightTab === 'preview' ? (
              <PreviewPanel sessionId={debugInfo.sessionId} />
            ) : (
              <TerminalPanel onSend={handleSend} isStreaming={isStreaming} sessionId={debugInfo.sessionId} />
            ))}
          </Pane>
        </PaneShell>
        </ErrorBoundary>

        {overlayPanel === 'settings' && (
          <OverlayView onClose={handleCloseOverlay} title="设置">
            <SettingsPanel onBack={handleCloseOverlay} />
          </OverlayView>
        )}
        {overlayPanel === 'theme' && (
          <OverlayView onClose={handleCloseOverlay} title="主题">
            <ThemePanel onClose={handleCloseOverlay} />
          </OverlayView>
        )}
        {overlayPanel === 'about' && (
          <OverlayView onClose={handleCloseOverlay} title="关于">
            <AboutPanel />
          </OverlayView>
        )}

        {/* Model Picker Overlay */}
        {showModelPicker && (
          <OverlayView onClose={handleCloseModelPicker} title="选择模型">
            <ModelPickerPanel
              models={modelDiscovery.models}
              grouped={modelDiscovery.grouped}
              loading={modelDiscovery.loading}
              error={modelDiscovery.error}
              selectedModel={(modelDiscovery.selectedModel || monitorState.modelName) ?? undefined}
              onSelect={modelDiscovery.selectModel}
              onRefresh={modelDiscovery.refresh}
              onClose={handleCloseModelPicker}
            />
          </OverlayView>
        )}
      </AppShell>

      <CommandCenter
        open={commandCenterOpen}
        onClose={() => setCommandCenterOpen(false)}
        sessions={sess.sessions}
        sessionTitles={sess.titles}
        sessionId={sess.sessionId ?? undefined}
        onSwitchSession={gridAwareSwitchSession}
        onNewSession={handleNewSession}
        onCommand={handleCommand}
        onNavigate={handleNavigate}
      />

      {/* Toast 通知栈 — 顶部居中浮动 */}
      <Toast />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </ThemeProvider>
  );
}
