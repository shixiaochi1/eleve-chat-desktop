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

  // ── F9+ 多 Profile：启动后拉取当前 active profile ──
  useEffect(() => {
    if (!portReady) return;
    let cancelled = false;
    getActiveProfile()
      .then((name) => { if (!cancelled) { setWsActiveProfile(name); setCurrentProfile(name); } })
      .catch(() => { /* 网关未就绪时静默，保持 default */ });
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
        setViewMode((prev) => (prev === 'single' ? 'grid' : 'single'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 面板切换时自动隐藏 DeepSeek WebView ──
  useEffect(() => {
    if (deepseekVisible) {
      hideDeepSeek().then(() => setDeepseekVisible(false));
    }
  }, [activePanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── session management（必须在 handleProfileChange 之前，切换 Agent 需要重置 session） ──
  const sess = useSessions();

  // Profile 切换联动：更新全局状态 + 重置会话 + 刷新会话列表
  // ── F1 多 Profile：setWsActiveProfile 必须同步调用（activeProfile 是模块级变量），
  //    保证下面 sessionListVersion 触发的列表 refetch 用到新 profile，避免异步 effect 竞态。
  //    对齐 Hermes setApiRequestProfile：currentProfile 是唯一权威源，sendRpc 单点盖章 params.profile。
  const handleProfileChange = useCallback((name: string) => {
    setWsActiveProfile(name);
    setCurrentProfile(name);
    setSessionListVersion((v) => v + 1);
    // 🔴 切换 Agent 必须清空当前 session，否则旧 session_id（agent:default:ws:xxx）
    //    路由到旧 Agent → 上下文/人设/记忆全是旧的
    sess.setSessionId(null);
    storage.save('session_id', null);
    sess.setFreshDraftReady(true);  // 下次发消息自动创建新 session（带新 profile 前缀）
    getWsClient().switchSession('');  // 清 WS client 内部 sessionId fallback
    storeSetMessages([]);  // 清空聊天界面（全局消息 store）
  }, [sess.setSessionId, sess.setFreshDraftReady]);

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
  });

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
  });

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
                  onSwitchSession={handleSwitchSession}
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
                <GridModeView currentProfile={currentProfile} onExitGrid={toggleViewMode} />
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
        onSwitchSession={handleSwitchSession}
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
