/**
 * GridModeView — 多 Agent 宫格全功能视图（模式 B）
 *
 * 北极星（老大 2026-07-30）：同时显示 N 个 Agent 的全功能聊天窗口（和单视图一样），
 * N 无上限（滚动网格），性能优先（ELEVE 常驻内存）。
 *
 * 架构：
 * - 本组件仅在 viewMode==='grid' 时挂载（App 条件渲染）→ 内部 useGridChat(true) 挂载即
 *   激活、卸载即清理。与单视图 useSSE 以 viewMode 为键天然互斥（App 层同步暂停 useSSE）。
 * - 状态层无上限：useGridChat 的 Record<profile, AgentChatState>，渲染层 CSS Grid auto-fill
 *   滚动网格（删除旧原型 slice(0,4) 硬编码 + 仅支持 2×2 的绝对定位拖拽系统）。
 * - 进入宫格：每个有历史 session 的 profile loadLatest（后端权威源）；无 session 的显示
 *   空态，sendTo 时后端建会话回填。
 * - 退出/展开：先把各 Agent 当前 session 指针写回 profile_session_map，再交回 App 刷新单视图。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchProfiles } from '../utils/api';
import * as storage from '../utils/storage';
import { Square } from 'lucide-react';
import { useGridChat, type AgentChatState } from '../hooks/useGridChat';
import AgentChatCard, { type AgentProfileInfo, type AgentCardColor } from './AgentChatCard';

// ── Agent 颜色调色板（对齐 --ui-* 设计 token）──
const AGENT_COLORS: AgentCardColor[] = [
  { dot: 'var(--ui-blue)',   ring: 'rgba(0,83,253,0.35)',   bg: 'rgba(0,83,253,0.06)' },
  { dot: 'var(--ui-green)',  ring: 'rgba(31,138,101,0.35)',  bg: 'rgba(31,138,101,0.06)' },
  { dot: 'var(--ui-purple)', ring: 'rgba(158,148,213,0.35)', bg: 'rgba(158,148,213,0.06)' },
  { dot: 'var(--ui-orange)', ring: 'rgba(219,112,75,0.35)',  bg: 'rgba(219,112,75,0.06)' },
];

// 尚未加载的 profile 的空状态（模块级常量 = 稳定引用，保证 AgentChatCard memo 生效）
const EMPTY_AGENT_STATE: AgentChatState = {
  sessionId: null, messages: [], hasMore: false, oldestId: null,
  isLoadingMore: false, status: 'idle', streamText: '', streamReasoning: '',
  pendingApproval: null, pendingClarify: null, pendingSudo: null, lastActivity: 0,
};

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
}

export default function GridModeView({ currentProfile, currentSessionId, onExitGrid, onExpandAgent }: GridModeViewProps) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [focusedName, setFocusedName] = useState<string | null>(currentProfile);

  // 宫格聊天引擎：挂载即激活（本组件仅 grid 模式挂载）
  const { states, loadLatest, loadMore, sendTo, abortAgent, clearPending } = useGridChat(true);

  // 状态镜像（退出/展开时读当前各 Agent session 指针）
  const statesRef = useRef(states);
  statesRef.current = states;

  // ── 拉取 Agent 列表 ──
  useEffect(() => {
    let cancelled = false;
    fetchProfiles()
      .then((data) => {
        if (cancelled) return;
        const list = data.profiles as ProfileInfo[];
        setProfiles(list);
        setFocusedName((prev) => prev ?? (list.find((p) => p.name === currentProfile)?.name ?? list[0]?.name ?? null));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentProfile]);

  // ── 进入宫格：为每个有历史 session 的 profile 加载最新 N 条（后端权威源） ──
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current || profiles.length === 0) return;
    loadedRef.current = true;
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    for (const p of profiles) {
      // 当前 profile 优先用 App 实时 sessionId（map 可能未及更新），其余用 per-profile 指针
      const sid = map[p.name] || (p.name === currentProfile ? currentSessionId : null);
      if (sid) loadLatest(p.name, sid);
    }
  }, [profiles, loadLatest, currentProfile, currentSessionId]);

  // ── 把各 Agent 当前 session 指针写回 localStorage（退出/展开前调用） ──
  const persistPointers = useCallback(() => {
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    let changed = false;
    for (const [p, s] of Object.entries(statesRef.current)) {
      if (s?.sessionId) { map[p] = s.sessionId; changed = true; }
    }
    if (changed) storage.save('profile_session_map', map);
  }, []);

  const handleExit = useCallback(() => {
    persistPointers();
    onExitGrid();
  }, [persistPointers, onExitGrid]);

  const handleExpand = useCallback((profile: string) => {
    persistPointers();
    onExpandAgent(profile);
  }, [persistPointers, onExpandAgent]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 顶部控制条 ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/30">
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors"
          title="返回单视图 (Ctrl+G)"
          onClick={handleExit}
        >
          <Square size={13} strokeWidth={1.5} />
          <span>单视图</span>
        </button>
        <span className="text-[11px] text-muted-foreground/50">
          {profiles.length} 个 Agent
        </span>
        <span className="text-[10px] text-muted-foreground/30 ml-auto">
          点击卡片聚焦 · 展开按钮切单视图
        </span>
      </div>

      {/* ── 滚动网格（CSS Grid auto-fill，N 无上限） ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
        {profiles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/40">
            加载 Agent 列表…
          </div>
        ) : (
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
          >
            {profiles.map((profile, i) => (
              <div
                key={profile.name}
                style={{ height: 'clamp(380px, 62vh, 620px)' }}
                onClick={() => setFocusedName(profile.name)}
              >
                <AgentChatCard
                  profile={profile}
                  state={states[profile.name] ?? EMPTY_AGENT_STATE}
                  color={AGENT_COLORS[i % AGENT_COLORS.length]}
                  focused={focusedName === profile.name}
                  onSend={sendTo}
                  onLoadMore={loadMore}
                  onAbort={abortAgent}
                  onClearPending={clearPending}
                  onExpand={handleExpand}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
