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
import { requestComposerInsert } from '@/lib/composer-events';
import { loadTerminalFontFromConfig } from '@/lib/terminal-font';
import { useSessions } from './hooks/useSessions';
import { useGatewayHealth } from './hooks/useGatewayHealth';
import { useMessageStream } from './hooks/useMessageStream';
import { usePromptActions } from './hooks/usePromptActions';
import { useImageAttachments } from './hooks/useImageAttachments';
import { useFileAttachments } from './hooks/useFileAttachments';
import { dragHasPaths, collectDroppedPaths } from '@/lib/paths-dnd';
import { useSessionActions } from './hooks/useSessionActions';
import { onWakeDetected } from './lib/wake-events';
import useModels from './hooks/useModels';
import { useMediaQuery } from './hooks/use-media-query';
import { loadMarkdownDeps } from './utils/markdown';
import * as storage from './utils/storage';
import { loadSettingsFromRust, loadSettings, isSettingsReady } from './utils/settings-store';
import { discoverPort, call, isDesktop } from './utils/bridge';
import { loadConnection, isRemoteMode, applyConnection } from './lib/connection';
import { getRememberedWorkspaceCwd, rememberWorkspaceCwd } from './lib/workspace-cwd';
import { getActiveProfile, fetchProfiles } from './utils/api';
import { getWsClient, setWsActiveProfile, type SessionCreateResponse } from './services/ws-client';
import { sessionIdMatchesProfile, profileFromSessionId, persistSessionPointer, clearSessionPointer, loadProfilePointers, saveProfilePointer, removeProfilePointer } from './utils/session';
import { notifyError } from './utils/notifications';
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
import ClarifyCard from './components/ClarifyCard';
import ApprovalCard from './components/ApprovalCard';
import SlashConfirmCard from './components/SlashConfirmCard';
import AppShell from './components/AppShell';
import PaneShell, { Pane, PaneMain, PaneCollapseBtn } from './components/PaneShell';
import FileBrowserPanel from './components/FileBrowserPanel';
import TerminalPanel from './components/TerminalPanel';
import PreviewCenter from './components/preview/PreviewCenter';
import ImageLightbox from './components/ImageLightbox';
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

// 🔴 2026-08-12 联动重构（老大需求：选 Agent → 点项目/HOME → 消息区 + 右侧文件联动）：
//   找某 Agent 某域的最新活跃会话：
//   - 项目域（path 非空）= 会话 cwd 在 path 下（前缀匹配 + 路径边界，防 C:\projAB 误判属于 C:\projA）
//   - HOME 域 = 该 Agent workspace 路径（后端注入 Home 桶 path；匹配 workspace 下会话）
//   按 last_active 降序取最新；无匹配返回 null
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

export default function App() {
  // ── 三栏布局 state ──
  const [activePanel, setActivePanel] = useState<string | null>('agents'); // 默认显示统一侧栏（Agent + 会话）
  const [panelWidth, setPanelWidth] = useState<number>(260);  // 侧边面板宽度（可拖动）

  // ── Responsive: auto-collapse left sidebar when window < 800px ──
  // 🔴 2026-08-06 修复（老大反馈：最小化再切回，侧边栏自动隐藏）：
  //   最小化时 WebView2 窗口宽度报告为 0/极小 → matchMedia 判定 isNarrow=true →
  //   误折叠。加 document.hidden 过滤（最小化/隐藏期间不折叠）；恢复时
  //   collapsedPanelRef 记住折叠前的面板并还原（旧代码只清标志不还原 → 侧栏丢失）。
  const isNarrow = useMediaQuery('(max-width: 799px)');
  const [responsiveCollapsed, setResponsiveCollapsed] = useState<boolean>(false);
  const collapsedPanelRef = useRef<string | null>(null);
  useEffect(() => {
    if (isNarrow && !document.hidden && activePanel) {
      collapsedPanelRef.current = activePanel;
      setActivePanel(null);
      setResponsiveCollapsed(true);
    } else if (!isNarrow && responsiveCollapsed) {
      setResponsiveCollapsed(false);
      if (collapsedPanelRef.current) {
        setActivePanel(collapsedPanelRef.current);
        collapsedPanelRef.current = null;
      }
    }
  }, [isNarrow, activePanel, responsiveCollapsed]);

  // ── 右侧抽屉 state（持久化，对齐 Hermes $paneStates/$rightRailActiveTabId）──
  const [rightOpen, setRightOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      return raw ? (JSON.parse(raw) as { open?: boolean }).open === true : false;
    } catch {
      return false;
    }
  });
  const [rightAnchor, setRightAnchor] = useState<{ winW: number; rightW: number }>(() => {
    // 🔴 2026-08-06 v4 确定性推导：右抽屉宽度锚点（PaneShell 内部派生 = 锚点 + 窗口变化量）
    // winW = 锚定时的窗口内容宽（CSS 像素）；rightW = 锚定时的右抽屉宽
    // 🔴 2026-08-08 v6：锚点持久化（eleve.rightPane.v1 附带 winW/rightW）——
    //   重启后恢复上次右抽屉宽度，不再回落默认 280；winW 随窗口恢复尺寸自动补偿
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      const a = raw ? (JSON.parse(raw) as { winW?: number; rightW?: number }) : null;
      return {
        winW: typeof a?.winW === 'number' && a.winW > 0 ? a.winW : (typeof window !== 'undefined' ? window.innerWidth : 900),
        rightW: typeof a?.rightW === 'number' ? Math.max(320, Math.min(800, a.rightW)) : 280,
      };
    } catch {
      return {
        winW: typeof window !== 'undefined' ? window.innerWidth : 900,
        rightW: 280,
      };
    }
  });
  const [rightTab, setRightTab] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      const tab = raw ? (JSON.parse(raw) as { tab?: string }).tab : undefined;
      return tab === 'files' || tab === 'terminal' || tab === 'preview' || tab === 'artifacts' ? tab : 'files';
    } catch {
      return 'files';
    }
  });
  // 🔴 2026-08-09 v2（对齐 Hermes PersistentTerminal mounted 语义）：
  // 首次“抽屉打开且终端 tab”才挂载 TerminalPanel——xterm open 必须有真实尺寸
  // （display:none 0×0 open → canvas 空、终端“什么都没有”）；之后保持挂载，
  // PTY 存活于隐藏（Tauri 侧 pty 不销毁，重开由 reviveBuffer 恢复屏幕）
  const [terminalMounted, setTerminalMounted] = useState(false);
  useEffect(() => {
    if (rightOpen && rightTab === 'terminal') setTerminalMounted(true);
  }, [rightOpen, rightTab]);
  useEffect(() => {
    try {
      localStorage.setItem('eleve.rightPane.v1', JSON.stringify({ open: rightOpen, tab: rightTab, winW: rightAnchor.winW, rightW: rightAnchor.rightW }));
    } catch { /* 存储不可用静默降级 */ }
  }, [rightOpen, rightTab, rightAnchor]);
  const handleToggleFiles = useCallback(() => setRightOpen(prev => !prev), []);

  // 🔴 2026-08-06 老大要求：右抽屉打开 = 窗口向右加宽（不挤压消息区）
  // - 窗口最小宽度 = 图标栏 52 + 左面板 panelWidth + 聊天区最小 480
  //   + (抽屉开 ? 右抽屉实际宽 : 0) + padding/gap 32（SIDE_CHROME）
  // - 开抽屉瞬间若窗口不足 → setSize 向右加宽（聊天区补到最小，右抽屉保持）
  // - widenedRef 防重复加宽：之后右抽屉/面板宽度变化只同步 min-size 不再 setSize
  // 🔴 2026-08-08 v6 重启挤压根治三修正：
  //   ① minSize 用实际右抽屉宽（原写死 240 → rightW=280/更大时窗口可缩到聊天区 < 480）
  //   ② 物理/CSS 像素统一：setSize/setMinSize 输入物理 = CSS×scaleFactor+border；
  //      锚点 winW 恒用 CSS（window.innerWidth）。原混用（after.width 物理写入锚点、
  //      布局/渲染读 CSS）→ 系统缩放率 ≠ 100% 时 rightW 错位被压到下限 → 重启挤压
  //   ③ 启动 1s 后重锚：窗口恢复/OS minSize 拉大等启动期窗口变化归零，不进入右抽屉增量
  const MIN_CHAT_WIDTH = 480;
  const SIDE_CHROME = 32; // pl-2/pr-2 padding 16 + grid gap-2 16
  const widenedRef = useRef(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { PhysicalSize } = await import('@tauri-apps/api/dpi');
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const size = await win.innerSize();
        // 🔴 物理宽 = 内容宽 + 边框差（setSize/setMinSize 是物理单位，calc 布局用内容宽）
        const border = Math.max(0, (await win.outerSize()).width - size.width);
        const rightW = rightOpen ? rightAnchor.rightW : 0;
        const minW = 52 + panelWidth + MIN_CHAT_WIDTH + SIDE_CHROME + rightW;
        // 🔴 before 必须 setMinSize 前读（OS clamp 拉大后 innerWidth 已是新值，
        //   1s 后比较恒等 → 重锚失效 → 拉大量仍算进右抽屉 → 挤压）
        const before = window.innerWidth;
        await win.setMinSize(new PhysicalSize(Math.round(minW * scale) + border, 400));
        if (rightOpen) {
          if (!widenedRef.current) {
            widenedRef.current = true;
            // 🔴 物理/CSS 换算：need 是 CSS 公式，setSize 输入物理 = CSS×scale+border
            if (before < minW) {
              await win.setSize(new PhysicalSize(Math.round(minW * scale) + border, size.height));
            }
          }
        } else {
          widenedRef.current = false;
        }
        // 🔴 启动 1s 后重锚（窗口恢复/minSize 拉大归零，不进入右抽屉增量 → 聊天区恒 ≥ 480）
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;
        if (window.innerWidth !== before) {
          setRightAnchor((prev) => ({ winW: window.innerWidth, rightW: prev.rightW }));
        }
      } catch (err) {
        console.warn('[App] window size sync failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [rightOpen, panelWidth, rightAnchor.rightW]);

  // 🔴 Artifact 右栏化（对齐 Hermes openArtifact → 打开右栏 tab）：
  // 消息内卡片点击 openArtifact() 后，单视图自动打开右栏并切到「产物」tab；
  // 宫格模式无右栏语义 → 浮层由 GridModeView 内挂载承载。
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
    // 终端字体配置（config.yaml terminal.font_family）——依赖 WS，portReady 后加载
    // （对齐 Hermes setTerminalFontFamilyFromConfig；面板保存会即时更新模块状态）
    void loadTerminalFontFromConfig();
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

  // 🔴 W-7: 会话 cwd（session.info 推送）— 传预览中心供重启预览使用
  // 会话切换时清空，等新会话的 session.info 重新推送
  const [sessionCwd, setSessionCwd] = useState('');
  // 🔴 2026-08-12 断线修复：项目行点击注入的 cwd 不被"会话切换清空"effect 抹掉
  //   （项目下无会话 → clearSessionView → setSessionId(null) → 旧逻辑把 cwd 清空 →
  //   文件面板回默认目录而非项目根，观感=点了项目没联动）。豁免一次：保留注入值，
  //   之后由 session.info 推送的会话真实 cwd 覆盖（Hermes 文件树=会话 cwd 语义）。
  const projectCwdInjectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (projectCwdInjectedRef.current) { projectCwdInjectedRef.current = null; return; }
    setSessionCwd('');
  }, [sess.sessionId]);

  // 🔴 2026-08-09 启动 seed（对齐 Hermes ensureDefaultWorkspaceCwd + $currentCwd
  // 初始值 = getRememberedWorkspaceCwd）：无会话时把工作目录 seed 到当前 cwd——
  //   remote → 上次工作目录记忆（per baseUrl+profile）
  //   local → 设置「默认工作目录」（settings.json default_project_dir；settings
  //     可能未从后端加载完 → isSettingsReady 轮询，SystemSettings 同款）
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
        }
        return true; // remote：记忆有无都算完成
      }
      if (!isSettingsReady()) return false;
      const def = loadSettings().default_project_dir?.trim() || '';
      if (def) {
        seededCwdRef.current = def;
        setSessionCwd(def);
      }
      return true;
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
  // ⚠️ 闭包陷阱：空依赖 useEffect 捕获首次渲染值 → 用 ref 持有最新会话 id / cwd
  const focusedSessionIdRef = useRef(sess.sessionId);
  focusedSessionIdRef.current = sess.sessionId;
  const sessionCwdRef = useRef(sessionCwd);
  sessionCwdRef.current = sessionCwd;

  // 🔴 2026-08-09 对齐 Hermes use-cwd-actions：文件面板切换目录 → 后端烙印持久化。
  //   有会话：session.cwd.set（后端烙印 + emit session.info → useMessageStream
  //   setSessionCwd 闭环，Hermes session.cwd.set 同款）；busy 时后端拒绝（catch 忽略，
  //   Hermes 同：session busy 4009）。无会话（新聊天未创建）：暂存为新会话目标
  //   （Hermes $newChatWorkspaceTarget 语义）——remote 模式由上方 effect 自动
  //   rememberWorkspaceCwd，后续 session.create 消费（App L859）
  const handleFilePanelCwdChange = useCallback((path: string) => {
    if (sess.sessionId) {
      void getWsClient().sendRpc('session.cwd.set', { session_id: sess.sessionId, cwd: path }).catch((e) => {
        console.warn('[App] session.cwd.set failed:', e);
      });
    } else {
      setSessionCwd(path);
    }
  }, [sess.sessionId]);

  useEffect(() => {
    return initPreviewEvents({
      getFocusedSessionId: () => focusedSessionIdRef.current,
      getCwd: () => sessionCwdRef.current || null,
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
      // 🔴 2026-08-12 断线修复：切 Agent 旧项目 scope 失效（对齐 Hermes 切 profile 后 scope stale）
      setProjectScopeCwd(null);
      projectCwdInjectedRef.current = null; // 🔴 清豁免标记：A 的项目 cwd 不残留到 B 的文件面板
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
    // 🔴 2026-08-12 断线修复：切 Agent 旧项目 scope 失效（对齐 Hermes 切 profile 后 scope stale，
    //   否则新 Agent 说话时 getNewSessionCwd 返回旧 Agent 的项目根 → 新会话落错项目）
    setProjectScopeCwd(null);
    projectCwdInjectedRef.current = null; // 🔴 清豁免标记：A 的项目 cwd 不残留到 B 的文件面板

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
    // 🔴 2026-08-12 断线修复：宫格→单视图同样清旧项目 scope（防新会话落错项目）
    setProjectScopeCwd(null);
    projectCwdInjectedRef.current = null; // 🔴 清豁免标记
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
  // 🔴 2026-08-11 对齐 Hermes openNewSessionTile：宫格新建 = 立即创建后端会话
  // 🔴 2026-08-12（老大需求：新建会话自动绑定当前 Agent + 选中项目）：
  //   scope（选中项目/workspace）注入新建会话链的单一入口——单视图新建按钮、
  //   /new 命令、宫格新建都走它；懒创建路径（无会话发消息）已由 getNewSessionCwd 消费
  const handleNewSessionWithScope = useCallback(async (title?: string) => {
    await handleNewSession(title, projectScopeCwdRef.current ?? undefined);
  }, [handleNewSession]);

  // （useSessions.create 激活——原无 UI 调用方的死链；卡片立即有真实会话而非懒创建）
  const gridAwareNewSession = useCallback(async () => {
    if (viewMode === 'grid') {
      // 🔴 2026-08-12 双创建断点修复：gridRef.newSession（handleGridNewSession）自
      //   2026-08-11 起已内部完整创建后端会话（resetAgent + onNewSessionEffects +
      //   sessionCreate + loadLatest + persistSessionPointer + onFocusChange）——
      //   旧代码再 sess.create + switchToSession = 第二次创建 → 第一个会话成孤儿。
      //   只走一条创建路径，scope（选中项目）由 newSession cwd 参数烙印。
      gridRef.current?.newSession(currentProfile, projectScopeCwdRef.current ?? undefined);
      return;
    }
    handleNewSessionWithScope();
  }, [viewMode, currentProfile, handleNewSessionWithScope]);

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
    getNewSessionCwd: () => {
      const scope = projectScopeCwdRef.current;
      if (scope) return scope;
      const seeded = seededCwdRef.current?.trim();
      return seeded || null;
    },
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
    if (path) {
      setSessionCwd(path);          // ① 文件面板 → 项目根 / workspace
      projectCwdInjectedRef.current = path; // 🔴 豁免"会话切换清空"（无会话场景文件面板停留目标目录）
      setProjectScopeCwd(path);     // ② 新会话落点 = 项目根 / workspace
    } else {
      setProjectScopeCwd(null);     // ② 空 path（旧后端兑底）：退出项目域
    }
    // ③ 消息区联动（推荐会话 = 后端分组权威：项目 = 该项目 previewSessions 最新；
    //    HOME = Home 桶 unowned 全集最新；无推荐 → 前端域匹配兑底 → 空态新建）
    if (viewMode === 'grid') {
      // 宫格：焦点 Agent 卡片切推荐/兑底最新会话（与单视图同一 target 规则，走
      // gridAwareSwitchSession 统一入口——宫格下自动路由 gridRef，不平行直调）；
      // 无 → 新会话带项目 cwd（HOME 则 workspace），卡片自治不打扰其它卡片
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
    // 当前会话已属于该项目 → 保持（任务运行中也不打断）
    if (belongs) return;
    if (isSendingRef.current) return; // busy：不打断
    if (recommendedSessionId) {
      if (recommendedSessionId === sid) return; // 已在该域最新会话 → 保持
      // 归属校验（后端分组权威，profile 校验防串台）
      if (sessionIdMatchesProfile(recommendedSessionId, currentProfile)) {
        gridAwareSwitchSession(recommendedSessionId);
        return;
      }
    }
    // 兑底：推荐缺失/归属不符 → 前端域匹配（项目= cwd 前缀；HOME= workspace 域）
    const latest = latestSessionForDomain(sess.sessions, currentProfile, path);
    if (latest) {
      if (latest.id === sid) return; // 已在该域最新会话 → 保持
      gridAwareSwitchSession(latest.id);
    } else {
      clearSessionView(currentProfile);
    }
  }, [sess, isSendingRef, clearSessionView, currentProfile, viewMode, gridAwareSwitchSession]);

  // 🔴 P1: 宫格模式 CommandCenter（CMD+K）命令执行路由进宫格（写入 per-agent 状态槽，非不可见的 zustand store）
  const gridAwareCommand = useCallback((cmdName: string, args: string) => {
    if (viewMode === 'grid') {
      // 🔴 2026-08-12（老大需求：新建会话自动绑定选中 Agent+项目）：宫格 /new 命令
      //   前端拦截 → 卡片新建带 scope cwd（后端 slash 无前端 scope 概念，直传会落
      //   workspace 而非选中项目）
      if (cmdName === 'new' || cmdName === 'reset') {
        gridRef.current?.newSession(currentProfile, projectScopeCwdRef.current ?? undefined);
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
    removeImage,
    clearImages,
    clearError: clearImageError,
    uploadUnuploaded,
  } = useImageAttachments({ getSessionId: () => sess.sessionId });

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

  // 图片大图预览（对齐 Hermes ImageLightbox：聊天区缩略图点击 → 遮罩大图 + 下载）
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);

  // 包装 handleSend — 附件排队归属 + 发送后清空预览
  // 🔴 对齐 Hermes entry 级附件归属：busy 时排队附件 base64 暂存内存 + 从 session 分离
  const handleSend = useCallback(async (text: string) => {
    // F5: barge-in — 用户发消息即打断正在播放的 TTS（对齐 Hermes
    // server.py L12842: 新 turn 开始 → _tts_stream_stop(user_barge=True)）。
    // fire-and-forget：打断失败不影响发送主流程。
    getWsClient().voiceTtsStop().catch(() => {});
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
          // 🔴 2026-08-11 对齐 Hermes createBackendSessionForSend（detached 语义）：
          // 项目 scope → 项目根；无 scope → 仅显式 default_project_dir / remote 记忆
          // （seededCwdRef）；❌ 不再继承当前显示 cwd（session.info 可能推成启动目录）
          let cwd: string | undefined;
          const scopeCwd = projectScopeCwdRef.current;
          if (scopeCwd) {
            cwd = scopeCwd;
          } else {
            const seeded = seededCwdRef.current?.trim();
            if (seeded) {
              cwd = seeded;
            }
          }
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
      if (!synced) return; // 对齐 Hermes: 附件同步失败 → 中止发送
    }

    // 准备附件元数据 + base64（排队用）
    const queuedAttachments = images.map((img) => ({
      id: img.id, name: img.name, size: img.size, preview: img.preview,
    }));
    const dataURLs = images.map((img) => img.preview);

    // 🔴 2026-08-09 文件附件 ref_text 注入（对齐 Hermes attachment.refText 语义）：
    // file.attach staging 的引用（@file:相对路径）合并进 prompt 文本，LLM 经 @file: 读取
    const fileRefs = attachedFiles.map((f) => f.refText).join(' ');
    const finalText = fileRefs ? `${fileRefs}\n${text}` : text;

    rawHandleSend(finalText, queuedAttachments.length > 0 ? queuedAttachments : undefined, dataURLs.length > 0 ? dataURLs : undefined);

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

  // ── load markdown deps + init port + init theme on mount ──
  // 🔴 P0-1: 会话恢复统一由 startupRestored effect 处理（含 sessionIdMatchesProfile 校验）。
  // mount 只预加载 cache/titles（无害），不设 sessionId、不加载消息。
  // 🔴 2026-08-11 清理：旧主题初始化块已删（storage 'theme' / 'eleve-theme' / dataset.theme
  // 是旧系统残留，零消费者；主题权威在 ThemeProvider（config.yaml display.skin + eleve-theme-v2）
  useEffect(() => {
    // 🔴 P1：loadSettingsFromRust 已移至 WS connect 后（下方 portReady effect）。
    // 旧实现在 mount 时调（WS 未连，sendRpc state='disconnected' 必 reject，无重试）→ 死代码。
    // 终端字体配置（config.yaml terminal.font_family）同样依赖 WS：放 portReady 后。
    loadMarkdownDeps().then(() => setDepsReady(true));

    if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
      // 🔴 Remote 模式（对齐 Hermes remote gateway）：跳过本地端口发现，
      // 直连远程 base（settings.json connection 配置；Tauri 壳可能仍本地
      // spawn eleved——远程部署时壳侧不 spawn 见 src-tauri 启动分支）
      const conn = loadConnection();
      if (isRemoteMode(conn) && conn.baseUrl) {
        applyConnection(conn);
        setPortReady(true);
      } else {
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
      }
    } else {
      setPortReady(true);
      // 🔴 浏览器模式同样支持 remote（dev 直连远程后端；对齐 Hermes remote）
      const conn = loadConnection();
      if (isRemoteMode(conn) && conn.baseUrl) {
        applyConnection(conn);
      }
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
      console.log('[App] Initiating WS connection (ELEVE: no session_id in URL)');
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
                  onNewSessionInProject={handleNewSessionInProject}
                  onEnterProject={handleProjectEntered}
                  sessionListVersion={sessionListVersion}
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
                          {attachedImages.map((img) => (
                            <div key={img.id} className="relative group">
                              <img
                                src={img.preview}
                                alt={img.name}
                                className="w-12 h-12 object-cover rounded-md border border-border cursor-zoom-in"
                                draggable={false}
                                onClick={() => setLightbox({ src: img.preview, name: img.name })}
                              />
                              <button
                                onClick={() => { void handleRemoveImage(img.id); }}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-primary-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                                title="移除图片"
                                aria-label={`Remove ${img.name}`}
                              >
                                ✕
                              </button>
                              <div className="text-xs text-muted-foreground truncate mt-1 max-w-[48px]" title={img.name}>
                                {img.name}
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
                  {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.name} onClose={() => setLightbox(null)} />}
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
                queueProfile={currentProfile}
                sessionId={sess.sessionId}
                onQueueSendNow={sendQueueNow}
                onQueueDelete={deleteQueueEntry}
              />
            </main>
            </div>
            )}
          </PaneMain>

          {/* 右侧面板：文件浏览器 / 终端 / 预览 / 产物（靠标签切换）
              🔴 终端常驻挂载：切 tab 只 CSS hidden，PTY shell 不死（对齐 Hermes
              PersistentTerminal “shell 存活于隐藏”）；其余面板按需渲染 */}
          <Pane side="right" className="pane-right-column">
            {rightOpen && (
              <>
                <RightSidebarTabs activeTab={rightTab} onTabChange={setRightTab} onClose={() => setRightOpen(false)} />
                {rightTab === 'files' && (
                  <FileBrowserPanel
                    cwd={sessionCwd}
                    sessionId={sess.sessionId}
                    onCwdChange={handleFilePanelCwdChange}
                    onFileAttach={(path: string) => requestComposerInsert(`@file:"${path}"`)}
                  />
                )}
                {rightTab === 'preview' && (
                  <PreviewCenter sessionId={sess.sessionId} cwd={sessionCwd} />
                )}
                {rightTab === 'artifacts' && (
                  <ArtifactPanel sessionId={sess.sessionId} onSwitchSession={handleSwitchSession} />
                )}
              </>
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
            <OverlayView onClose={handleCloseOverlay} title="设置">
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
    </ThemeProvider>
  );
}
