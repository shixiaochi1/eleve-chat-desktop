import { useState, useEffect, useRef, useCallback } from 'react';
import { useMessages, setMessages as storeSetMessages, getMessages } from './store/messages';
import { useSessions } from './hooks/useSessions';
import { useGatewayHealth } from './hooks/useGatewayHealth';
import { useMessageStream } from './hooks/useMessageStream';
import { usePromptActions } from './hooks/usePromptActions';
import { useSessionActions } from './hooks/useSessionActions';
import useModels from './hooks/useModels';
import { useMediaQuery } from './hooks/use-media-query';
import { loadMarkdownDeps } from './utils/markdown';
import * as storage from './utils/storage';
import { loadSettingsFromRust } from './utils/settings-store';
import { discoverPort, call } from './utils/bridge';
import { getWsClient } from './services/ws-client';
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
import MessageContainer from './components/MessageContainer';
import InputArea from './components/InputArea';
import ContextBar from './components/ContextBar';
import ClarifyCard from './components/ClarifyCard';
import ApprovalCard from './components/ApprovalCard';
import AppShell from './components/AppShell';
import PaneShell, { Pane, PaneMain, PaneCollapseBtn } from './components/PaneShell';
import FileBrowserPanel from './components/FileBrowserPanel';
import TerminalPanel from './components/TerminalPanel';
import RightSidebarTabs from './components/RightSidebarTabs';
import CommandCenter from './components/CommandCenter';
import Toast from './components/Toast';
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
function timeLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

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
  const [activeClarify, setActiveClarify] = useState<{ clarify_id: string; question: string; choices: string[] } | null>(null);
  const [activeApproval, setActiveApproval] = useState<{ command: string; description: string; pattern: string; choices: string[]; run_id: string } | null>(null);
  const [activeSudo, setActiveSudo] = useState<{ request_id: string; prompt?: string } | null>(null);
  const [activeSecret, setActiveSecret] = useState<{ request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } | null>(null);

  // ── overlay panel state (settings, about) ──
  const [overlayPanel, setOverlayPanel] = useState<string | null>(null);
  const handleOpenOverlay = useCallback((panelName: string) => setOverlayPanel(panelName), []);
  const handleCloseOverlay = useCallback(() => setOverlayPanel(null), []);

  // ── model picker state ──
  const [showModelPicker, setShowModelPicker] = useState<boolean>(false);
  const handleOpenModelPicker = useCallback(() => setShowModelPicker(true), []);
  const handleCloseModelPicker = useCallback(() => setShowModelPicker(false), []);

  // ── model discovery ──
  const modelDiscovery = useModels({ enabled: portReady });

  const nextId = useRef<number>(0);
  const genId = useCallback(() => `m${++nextId.current}`, []);

  // ── session management ──
  const sess = useSessions();

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

  // ── time badge — derived from timestamps, not separate messages ──
  const lastTimeRef = useRef<string>('');
  const addTimeBadge = useCallback(() => {
    const t = timeLabel();
    if (t === lastTimeRef.current) return;
    lastTimeRef.current = t;
    // Time badges are derived from message timestamps; no message created here
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
    lastTimeRef,
    resetSendingLock: undefined, // will be wired after usePromptActions
  });

  // ── usePromptActions: send/regenerate/abort/queue ──
  const {
    handleSend,
    handleAbort,
    handleRegenerate,
    handleCommand,
    handleBtw,
    drainQueue,
    resetSendingLock,
  } = usePromptActions({
    sess,
    addTimeBadge,
    genId,
    setConnectionStatus,
    setDebugInfo: setDebugInfo as any,
    addDebugEvent,
    setSessionListVersion,
    send,
    abort,
    handleNewSession,
  });

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

    loadSettingsFromRust();
    loadMarkdownDeps().then(() => setDepsReady(true));

    if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
      const portPromise = discoverPort();

      storage.init().then(async () => {
        const restoredId = storage.load('session_id', null) as string | null;
        if (restoredId && restoredId !== sess.sessionId) {
          sess.setSessionId(restoredId);
        }
        // 🔴 对齐 Hermes TUI：启动时必须有 session，否则 WS 无法连接
        // Hermes TUI 在 WS 连接时自动创建 session，Eleve 在前端创建
        if (!restoredId && !sess.sessionId) {
          console.log('[App] No session_id found, creating default session (align Hermes TUI)');
          await sess.create();
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
        // 🔴 对齐 Hermes TUI：启动时必须有 session
        if (!restoredId && !sess.sessionId) {
          console.log('[App] No session_id found, creating default session (align Hermes TUI)');
          await sess.create();
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
      <span className="titlebar-logo"><img src="/eleve_logo.png" alt="Eleve" className="titlebar-logo-img" /> Eleve Chat</span>
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
            <div className="chat-card">
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
              {!portReady && messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                  <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 14 }}>正在连接 Agent...</p>
                </div>
              ) : (
                <>
                  <MessageContainer
                    onRegenerate={handleRegenerate}
                    gatewayOnline={gatewayHealth.online}
                    onGatewayRetry={gatewayHealth.checkNow}
                    onOpenSettings={() => handleOpenOverlay('settings')}
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
                  <ContextBar sessionId={sess.sessionId} sessionStartedAt={debugInfo.sessionStartedAt} onNewSession={handleNewSession} onBtw={handleBtw} />
                </>
              )}
              <InputArea onSend={handleSend} onCommand={handleCommand} onAbort={handleAbort} isStreaming={isStreaming} portReady={portReady} />
            </main>
            </div>
          </PaneMain>

          {/* 右侧面板：文件浏览器 / 终端 (靠标签切换) — 只在 rightOpen 时渲染子元素，避免 TerminalPanel 在 0 宽容器中初始化 xterm.js */}
          <Pane side="right" className="pane-right-column">
            {rightOpen && <RightSidebarTabs activeTab={rightTab} onTabChange={setRightTab} />}
            {rightOpen && (rightTab === 'files' ? (
              <FileBrowserPanel onFileAttach={(path: string) => handleSend(`/file ${path}`)} />
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
