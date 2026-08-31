import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTerminalFontFromConfig } from '../lib/terminal-font';
import { loadMarkdownDeps } from '../utils/markdown';
import * as storage from '../utils/storage';
import { loadSettingsFromRust } from '../utils/settings-store';
import { discoverPort } from '../utils/bridge';
import { loadConnection, isRemoteMode, applyConnection } from '../lib/connection';
import { getActiveProfile, fetchProfiles } from '../utils/api';
import { getWsClient, setWsActiveProfile } from '../services/ws-client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { notifyInfo } from '../utils/notifications';
import { getMessages } from '../store/messages';
import { touchAndPruneMsgCache, clampCacheTails } from '../lib/msg-cache';
import { loadDisplaySettings } from '../store/display-settings';
import type { ChatMessage } from '../types';
import type { useSessions } from './useSessions';

/**
 * useBootstrap — 启动编排（port / storage / profile / deps 门控）
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 App.tsx 纯移动抽取（diff 无逻辑变更）。只拆组织，不动状态归属——
 *   启动相关 state 单一权威源仍在本 hook，App 经返回值消费。
 *
 * 职责：
 * - 端口发现（Tauri / 浏览器双分支，remote 直连跳过）
 * - storage.init + 冷启动缓存恢复（msg_cache / titles）
 * - getActiveProfile（带重试 + 降级标志 profileDegradedRef）
 * - WS 连接建立（portReady 后）+ loadSettingsFromRust
 * - beforeunload 消息缓存落盘
 * - Agent 数量 / Display 设置 / 终端字体（portReady 后拉取）
 * - 昵称/颜色/头像映射（ProfilePanel 上抛）与编辑面板目标
 */
export function useBootstrap({ sess }: { sess: ReturnType<typeof useSessions> }) {
  const [connectionStatus, setConnectionStatus] = useState<string>('idle');
  const [depsReady, setDepsReady] = useState<boolean>(false);
  const [portReady, setPortReady] = useState<boolean>(false); // 需要 discoverPort 后才就绪
  const [storageReady, setStorageReady] = useState<boolean>(false); // 🔴 P0-1: storage.init() 成功后才允许恢复会话
  const [profileResolved, setProfileResolved] = useState<boolean>(false); // 🔴 P0-2: getActiveProfile 完成后才允许恢复会话
  const [currentProfile, setCurrentProfile] = useState<string>('default');  // F9+ 当前活动 Profile（多 Profile 全局状态）
  const [agentCount, setAgentCount] = useState<number>(1);  // Agent 数量（宫格按钮禁用判断）
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [agentColors, setAgentColors] = useState<Record<string, string>>({});
  const [agentAvatarKeys, setAgentAvatarKeys] = useState<Record<string, string>>({});
  const [profileRefreshSignal, setProfileRefreshSignal] = useState(0);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const profileDegradedRef = useRef(false); // 🔴 P1-5: getActiveProfile 重试耗尽降级标志
  const bumpProfileRefresh = useCallback(() => setProfileRefreshSignal((t) => t + 1), []);

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

  // ── Display 设置：display.show_reasoning（config.yaml per-profile 权威源）──
  // portReady / 切 Agent 时重拉，防止多 Profile 显示设置串台（加载失败回落默认 true）。
  useEffect(() => {
    if (!portReady) return;
    void loadDisplaySettings();
  }, [portReady, currentProfile]);

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

  // ── shell.* / canvas.* 帧监听（画布插件化 S5 + 2026-08-19 根治修订）──
  // gateway 经 WS 推 shell.open_canvas / shell.toggle_canvas / shell.close_canvas
  // （控制面文档 infinite-canvas-control-plane-20260818.md 帧协议）→ 壳执行
  // 窗口命令（open=ensure 单例开窗；toggle=按可见性隐藏/显示，2026-08-19
  // 按钮切换需求；close=销毁）；canvas.ready / canvas.closed（注册表状态
  // 转换事件，事件驱动）→ 壳提示。
  // 🔴 红线：窗口生命周期归壳，gateway 只发意图帧；单例由 canvas 唯一
  // label 硬约束，任何意图绝不新建第二个窗口。
  useEffect(() => {
    if (!portReady) return;
    const wsClient = getWsClient();
    const unsub = wsClient.addEventListener((event, data) => {
      if (!isTauri()) return; // remote/浏览器模式无 Tauri 壳，帧无落地目标
      if (event === 'shell.open_canvas') {
        console.log('[Shell] open_canvas frame', data);
        invoke('open_canvas_window').then(
          (r) => console.log('[Shell] canvas opened:', r),
          (e) => console.error('[Shell] open_canvas failed:', e),
        );
      } else if (event === 'shell.close_canvas') {
        console.log('[Shell] close_canvas frame', data);
        invoke('close_canvas_window').then(
          (r) => console.log('[Shell] canvas closed:', r),
          (e) => console.error('[Shell] close_canvas failed:', e),
        );
      } else if (event === 'shell.toggle_canvas') {
        // 🔴 2026-08-19 按钮切换语义：画布已连时按钮意图 = 切换可见性
        // （可见→隐藏 / 隐藏→显示），单例由 toggle_canvas_window 的
        // get_webview_window("canvas") 唯一 label 硬约束，绝不新建第二个
        console.log('[Shell] toggle_canvas frame', data);
        invoke('toggle_canvas_window').then(
          (r) => console.log('[Shell] canvas toggled:', r),
          (e) => console.error('[Shell] toggle_canvas failed:', e),
        );
      } else if (event === 'canvas.ready') {
        // 画布 WS 注册表空→非空（窗口弹出 + WS 建连完成）——事件驱动，无轮询
        console.log('[Shell] canvas.ready frame', data);
        notifyInfo('画布已连接 ELEVE');
      } else if (event === 'canvas.closed') {
        // 画布 WS 注册表→空（窗口关闭/断连）
        console.log('[Shell] canvas.closed frame', data);
      }
    });
    return unsub;
  }, [portReady]);

  // ── beforeunload: 用 ref 拿最新 messages，避免依赖 [messages] 导致白屏 ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sid = storage.load('session_id') as string | null;
      if (sid) {
        const cache = storage.load('msg_cache', {} as Record<string, ChatMessage[]>) as Record<string, ChatMessage[]>;
        cache[sid] = getMessages();
        // 🔴 2026-09-01 内存修复：落盘前 touch+裁剪（防止 beforeunload 快照
        // 突破 LRU 上限——旧实现直接全量 saveBeacon）；
        // 🔴 复核补充：tail 截断——上翻工作集不得经 beforeunload 全量回灌
        storage.saveBeacon('msg_cache', clampCacheTails(touchAndPruneMsgCache(cache, sid)));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return {
    connectionStatus,
    setConnectionStatus,
    depsReady,
    portReady,
    setPortReady,
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
  };
}
