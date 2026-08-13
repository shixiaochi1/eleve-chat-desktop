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
    resetAgent, execCommand, handleSlashConfirmDone, sendQueueNow, deleteQueueEntry,
  } = grid;

  // 4. 加载目标会话
  useEffect(() => {
    if (portReady && profileName && sessionId) {
      void loadLatest(profileName, sessionId);
    }
  }, [portReady, profileName, sessionId, loadLatest]);

  const profile = useMemo(
    () => profiles.find((p) => p.name === profileName) ?? null,
    [profiles, profileName],
  );
  const state = states[profileName] ?? EMPTY_STATE;
  const color = cardColor(profile?.color || 'var(--dt-primary)');

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
        onSend={(p, text, attachments, attachmentDataURLs, sid) =>
          void sendTo(p, text, undefined, { attachments, attachmentDataURLs, explicitSessionId: sid })}
        onLoadMore={loadMore}
        onAbort={abortAgent}
        onClearPending={clearPending}
        onExpand={() => {}}
        onNewSession={resetAgent}
        onCommand={execCommand}
        onSlashConfirmDone={handleSlashConfirmDone}
        onQueueSendNow={sendQueueNow}
        onQueueDelete={deleteQueueEntry}
      />
    </div>
  );
}
