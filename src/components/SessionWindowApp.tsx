/**
 * SessionWindowApp — 会话独立窗口（?panel=session&session_id=<id>&profile=<p>）
 *
 * 对齐 Hermes openSession target='window'：把会话弹到独立窗口继续对话。
 * 复用 useGridChat + AgentChatCard（完整对话 UI：历史/发送/流式/审批/排队），
 * 不重复造轮子——窗口只是"单 Agent 宫格卡片"的独立承载。
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader } from 'lucide-react';
import { discoverPort } from '../utils/bridge';
import { fetchProfiles } from '../utils/api';
import { useGridChat, type AgentChatState } from '../hooks/useGridChat';
import { sessionIdMatchesProfile } from '../utils/session';
import AgentChatCard, { type AgentProfileInfo } from './AgentChatCard';

// 窗口内单卡片颜色（对齐 GridModeView cardColorFromHex 派生规则）
function cardColor(hex: string) {
  return {
    dot: hex,
    ring: `color-mix(in srgb, ${hex} 35%, transparent)`,
    bg: `color-mix(in srgb, ${hex} 6%, transparent)`,
  };
}

const EMPTY_STATE: AgentChatState = {
  sessionId: null, messages: [], hasMore: false, oldestId: null,
  isLoadingMore: false, status: 'idle',
  pendingApproval: null, pendingClarify: null, pendingSudo: null, pendingSecret: null,
  pendingSlashConfirm: null, streamParts: [], activityHint: '', sessionTitle: null, modelName: null, lastUsage: null, lastActivity: 0,
};

export default function SessionWindowApp() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || '';
  const profileName = params.get('profile') || '';
  // 🔴 2026-08-13 归属校验 fail-closed：URL 是唯一输入源（可被篡改/内部生成错误），
  // 加载前必须校验 session_id 归属 profile——不匹配 → 错误态，不加载不发送
  // （旧格式纯 UUID 无法判定 → sessionIdMatchesProfile 放行，与全局语义一致）
  const [validationError, setValidationError] = useState<string | null>(null);

  const [portReady, setPortReady] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([]);

  // 1. WS 端口探测（对齐 KanbanWindowApp 模式）
  useEffect(() => {
    let cancelled = false;
    void discoverPort().then((ok) => { if (!cancelled) setPortReady(ok); });
    return () => { cancelled = true; };
  }, []);

  // 2. profile 信息（卡片头像/颜色/模型展示）
  useEffect(() => {
    let cancelled = false;
    void fetchProfiles()
      .then((res) => { if (!cancelled) setProfiles(Array.isArray(res.profiles) ? (res.profiles as AgentProfileInfo[]) : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 3. 宫格聊天状态（单 Agent 承载；复用既有完整链路）
  // 🔴 2026-08-13 并发修复：独立窗口不写 localStorage 全局指针/profile_session_map——
  // 窗口会话由 URL 显式指定，无需持久化；防与主窗口并发写互相污染（主窗口的
  // session 指针/unread 判定基准被窗口覆盖 = 串台）。
  const grid = useGridChat(true, { persistGlobalPointers: false });
  const {
    states, loadLatest, sendTo, loadMore, abortAgent, clearPending,
    resetAgent, execCommand, handleSlashConfirmDone,
  } = grid;

  // 4. 加载目标会话（🔴 2026-08-13：归属校验通过才加载——fail-closed）
  useEffect(() => {
    if (!sessionId || !profileName) {
      setValidationError('缺少会话或 Agent 参数');
      return;
    }
    if (!sessionIdMatchesProfile(sessionId, profileName)) {
      setValidationError('会话归属校验失败（会话不属于该 Agent）');
      return;
    }
    setValidationError(null);
    if (portReady) {
      void loadLatest(profileName, sessionId);
    }
  }, [portReady, profileName, sessionId, loadLatest]);

  // 🔴 2026-08-13：profiles 列表加载成功后校验 Agent 存在（列表失败不误报——网络抖动不拦）
  useEffect(() => {
    if (validationError) return;
    if (profiles.length === 0 || !profileName) return;
    if (!profiles.some((p) => p.name === profileName)) {
      setValidationError(`Agent「${profileName}」不存在或已被删除`);
    }
  }, [profiles, profileName, validationError]);

  const profile = useMemo(
    () => profiles.find((p) => p.name === profileName) ?? null,
    [profiles, profileName],
  );
  const state = states[profileName] ?? EMPTY_STATE;
  const color = cardColor(profile?.color || 'var(--dt-primary)');

  // 校验失败 → 错误态（fail-closed：不加载、不发送）
  if (validationError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <span className="text-sm font-medium text-destructive">{validationError}</span>
        <button className="text-xs text-primary hover:underline" onClick={() => window.close()}>关闭窗口</button>
      </div>
    );
  }

  // 加载中（端口未就绪 / 会话未加载）
  if (!portReady || !profileName || !sessionId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader size={22} className="animate-spin" />
        <span className="text-xs">{portReady ? '会话加载中…' : '正在连接服务…'}</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-background p-3">
      <AgentChatCard
        profile={profile ?? ({ name: profileName } as AgentProfileInfo)}
        state={state}
        color={color}
        focused
        portReady={portReady}
        onSend={(p, text, attachmentDataURLs, sid) =>
          void sendTo(p, text, undefined, { attachmentDataURLs, explicitSessionId: sid })}
        onLoadMore={loadMore}
        onAbort={abortAgent}
        onClearPending={clearPending}
        onExpand={() => {}}
        onNewSession={resetAgent}
        onCommand={execCommand}
        onSlashConfirmDone={handleSlashConfirmDone}
      />
    </div>
  );
}
