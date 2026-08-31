import { useCallback, type MutableRefObject } from 'react';
import { activateSession, resetSession } from '../utils/api';
import { setMessages as storeSetMessages } from '../store/messages';
import { setMonitor } from '../store/debug';
import { getWsClient } from '../services/ws-client';
import { clearSessionPointer, persistSessionPointer, profileFromSessionId, removeProfilePointer, sessionIdMatchesProfile } from '../utils/session';
import type { SessionManagerHandle } from './useSessions';
import { textPart } from '@/lib/chat-messages'
import type { ChatMessage } from '@/types';

/**
 * Helper: short ID display
 */
function shortId(id: string): string {
  return id ? id.slice(0, 8) : '—';
}

/**
 * useSessionActions — session switch/delete/new logic
 *
 * Extracted from App.jsx. Handles session switching (with cache save/restore
 * and backend status check), session deletion, and new session creation.
 *
 * Returns { handleSwitchSession, handleDeleteSession, handleNewSession }
 */
export function useSessionActions({
  sess,
  genId,
  setSessionListVersion,
  resetSendingLock,
  resetStream,
  currentSessionIdRef,
  currentProfile,
}: {
  sess: SessionManagerHandle
  genId: () => string
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  resetSendingLock?: () => void
  resetStream?: (nextSessionId?: string | null) => void
  /** 🔴 当前显示 session 的同步权威 ref（resetStream 锁定）——loadHistory 过期响应守卫必须比它 */
  currentSessionIdRef: MutableRefObject<string | null>
  /** 🔴 2026-08-13 P2-1：切会话前归属校验（串台防御纵深） */
  currentProfile?: string
}): {
  handleSwitchSession: (id: string) => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  /** 🔴 2026-08-12 新增 cwd 参数：新建会话绑定选中项目（scope 烙印），
   *  reset 返回新 id 后 session.cwd.set —— 新会话空闲可烙，失败静默（后端 resolve 兜底） */
  handleNewSession: (title?: string, cwd?: string) => Promise<void>
} {
  // ── session switch handler ──
  // 🔴 后端是消息唯一权威源，始终 loadHistory，缓存仅秒显占位
  const handleSwitchSession = useCallback(async (id: string) => {
    if (id === sess.sessionId) return;
    // 🔴 2026-08-13 P2-1：串台防御纵深——切会话前校验归属。
    // id 来源均为后端权威列表（session.list / projects.tree / 刚创建的 sid），
    // 此校验为兑底：防未知来源 id 串台 + 防未校验 id 经 switchTo 污染 profile_session_map。
    // 旧格式 id（纯 UUID）无法判定 → sessionIdMatchesProfile 放行。
    if (currentProfile && !sessionIdMatchesProfile(id, currentProfile)) return;
    resetSendingLock?.();
    // 🔴 串台根因修复：同步锁定过滤 ref 到目标 session
    resetStream?.(id);
    sess.switchTo(id);
    sess.refresh();
    setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));

    try {
      const status = await activateSession(id) as { status?: string; info?: { is_reset?: boolean; reset_reason?: string } };
      if (status.info?.is_reset) {
        sess.saveCache((cache) => { const c = { ...cache }; delete c[id]; return c; });
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已重置 (${shortId(id)})，新消息将从空白上下文开始`)] }]);
        return;
      }
    } catch {
      // 后端不可达（离线），fallback 到缓存
    }

    // 缓存秒显（防白屏），始终被后端覆盖
    const cached = sess.msgCache[id];
    storeSetMessages(cached?.length ? (cached as ChatMessage[]) : []);
    // 🔴 始终从后端加载完整历史
    sess.loadHistory(id).then((msgs) => {
      if (currentSessionIdRef.current !== id) return; // 🔴 过期响应守卫：同步权威 ref（resetStream 已锁定）
      if (msgs?.length) {
        storeSetMessages(msgs as ChatMessage[]);
        sess.saveCache((cache) => ({ ...cache, [id]: msgs }));
      } else if (!cached?.length) {
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已切换 (${shortId(id)})`)] }]);
      }
    });
  }, [sess, genId, resetSendingLock, resetStream, currentSessionIdRef, currentProfile]);

  // ── session delete handler ──
  const handleDeleteSession = useCallback(async (id: string) => {
    sess.remove(id);
    // 🔴 P1-5: 删除会话同步清 profile_session_map，防僵尸指针复活
    const owner = profileFromSessionId(id);
    if (owner) {
      removeProfilePointer(owner, id);
    }
    // 🔴 订阅注册表：删除的会话从重连 re-attach 集合中移除
    getWsClient().detachSession(id);
    if (sess.sessionId === id) {
      storeSetMessages([]);
      // 🔴 P1-2.4: 删当前会话时释放锁 + 清 WS client session（对齐 handleNewSession）
      resetSendingLock?.();
      // 🔴 串台根因修复：删当前会话 → 无会话，同步锁定过滤 ref 为 null
      resetStream?.(null);
      getWsClient().switchSession('');
    }
    if (setSessionListVersion) setSessionListVersion(v => v + 1);
  }, [sess, setSessionListVersion, resetSendingLock, resetStream]);

  // ── new session — 对齐 Hermes /new /reset 行为语义（2026-08-11 修复）
  // 有会话 → 走后端 session.reset RPC 完整终结链（对齐 Hermes _handle_reset_command：
  //   interrupt 在飞 turn + finalize + 子Agent中断(#55578) + 凭证清理 + DB轮换 + hooks）
  // 无会话 → 纯前端 draft（对齐 Hermes 桌面端 startFreshSessionDraft）
  const handleNewSession = useCallback(async (title?: string, cwd?: string) => {
    // 🔴 2026-08-05 防御：调用方可能误传非字符串（onClick 直绑传 MouseEvent 等）。
    // 若此处抛错，前面 setSessionId(null)/switchSession('') 已执行 → 会话被清空但
    // 后续流程中断 → 下次发送传 null → 后端自动新建会话。入口统一防御：非字符串忽略。
    const safeTitle = typeof title === 'string' ? title : undefined;
    resetSendingLock?.();
    // 🔴 串台根因修复：新建会话 → 无会话，同步锁定过滤 ref 为 null
    resetStream?.(null);
    // 清空前端状态（不触发后端请求）
    storeSetMessages([]);
    // 🔴 P1-6: 先捕获 profile 再清 sessionId（否则 profileFromSessionId 拿到 null）
    const currentSid = sess.sessionId;
    const prevProfile = profileFromSessionId(currentSid) || undefined;
    // 默认懒创建标记（无会话/降级路径）；reset 成功拿到新会话 → 非懒创建
    let isLazyDraft = true;
    if (currentSid) {
      // 🔴 2026-08-11 对齐 Hermes TUI /new：旧会话必须真正终结，不能纯前端丢弃
      // （旧 turn/子Agent 无 owner 烧 token + 凭证/approval/todo 残留 + 插件 hooks 不触发）
      const ws = getWsClient();
      try {
        // 1. 中断在飞 turn（对齐 Hermes invalidate_session_run_generation 的"立即中断"
        //    语义；Rust actor 命令串行，reset 需等 turn 收尾，interrupt 加速）
        ws.abortStream(currentSid).catch(() => {});
        // 2. 后端轮换：旧会话终结（memory preserved）+ 返回新 session_id
        // 🔴 2026-08-12 老大：reset 直传 scope cwd——后端创建新会话时同步烙印（防 cwd.set 竞态）
        const data = await resetSession(currentSid, cwd?.trim() || undefined) as { session_id?: string; id?: string };
        const newId = data?.session_id || data?.id;
        if (newId) {
          // 新会话已由后端创建（非懒创建）；指针/WS 同步到新 id
          sess.setSessionId(newId);
          persistSessionPointer(newId);
          ws.switchSession(newId);
          // 🔴 2026-08-12（老大需求：新会话自动绑定选中 Agent+项目）：scope 已在 reset
          //   RPC 内由后端直接烙印（reset_session cwd 参数，mapping 后 UPSERT 落库）——
          //   无需再 fire-and-forget session.cwd.set（同一 RPC 返回前完成，零竞态）
          isLazyDraft = false;
        } else {
          // 后端异常未返回新 id → 降级纯前端（Hermes startFreshSessionDraft 语义）
          sess.setSessionId(null);
          clearSessionPointer(prevProfile);
          ws.switchSession('');
        }
      } catch {
        // 后端不可达/会话已被清理 → 降级纯前端，首条消息发送时自动新建
        sess.setSessionId(null);
        clearSessionPointer(prevProfile);
        ws.switchSession('');
      }
    } else {
      // 无会话 → 纯前端 draft（Hermes startFreshSessionDraft 同款）
      sess.setSessionId(null);
      clearSessionPointer(prevProfile);
      // 🔴 Fix BUG#1: 同步清除 WS client 内部 session ID，防止 promptSubmit fallback 到旧 ID
      // 不清除 → 首条消息发到旧 session → agent 带旧上下文回复 → "新建会话"名存实亡
      getWsClient().switchSession('');
    }
    sess.setFreshDraftReady(isLazyDraft);
    // 对齐 Hermes: /new <title> 时暂存标题，懒创建后设置
    if (safeTitle?.trim()) {
      sess.setPendingTitle(safeTitle.trim());
    } else {
      sess.setPendingTitle(null);
    }
    // 刷新会话列表（旧会话 reset 后保留为历史，新会话入列）
    sess.refresh();
    setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
    if (setSessionListVersion) setSessionListVersion(v => v + 1);
  }, [sess, setSessionListVersion, resetSendingLock, resetStream]);

  return {
    handleSwitchSession,
    handleDeleteSession,
    handleNewSession,
  };
}
