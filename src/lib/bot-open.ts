/**
 * bot-open — 打开某个 Agent 的常驻私聊（本机 / 远端两条链）。
 *
 * 🔴 2026-09-16 round-116 P4（Agent 面板整合）：从旧 `components/BotsPane.tsx`
 * （本机 `:515-535` / 远端 `:540-585`）抽出，供新面板的私聊分组复用。
 *
 * 两条链的语义逐条保持：
 *   - **本机**：`bot.chat.ensure(profile)` → 拿 canonical 会话 id → 清未读 →
 *     交给 App 的 `handleOpenBotChat(sid)`（登记 bot 域 + 切单视图 + 切会话）。
 *     ⚠️ 传下去的是 **session id**（App 侧 `profileFromSessionId` 反解 profile）。
 *   - **远端**：`requestForBot` 骑 owner 连接 ensure（**显式传目标 profile**——
 *     route 的 `profile:'default'` 只用于寻址，不能顶替 ensure 的目标）→
 *     `openRemoteChat`（主区显示远端会话）→ 调用方补主区导航。
 */
import { requestForBot } from '../services/connections';
import { ensureBotChat } from '../utils/api';
import { markBotRead } from '../hooks/useBotUnread';
import { openRemoteChat, type UnionRosterRow } from '../plugins/bots/state';

export interface OpenLocalBotChatOptions {
  /** App.handleOpenBotChat —— 收 session id（登记 bot 域 + 切视图 + 切会话） */
  onOpenBotChat: (sessionId: string) => void;
  onError?: (message: string) => void;
}

/** 打开**本机** Agent 的常驻私聊（无则后端懒建）。 */
export async function openLocalBotChat(
  profile: string,
  { onOpenBotChat, onError }: OpenLocalBotChatOptions,
): Promise<void> {
  try {
    const sid = await ensureBotChat(profile);
    // ack 锚定 canonical 会话（未读键公式），profile 仅作无会话回退；
    // 两个键都清——键会随 canonical 出现而漂移（round-76）
    markBotRead(profile, sid || undefined);
    if (sid) onOpenBotChat(sid);
  } catch (e) {
    onError?.((e as Error).message);
  }
}

export interface OpenRemoteBotChatOptions {
  /** 主区导航（对齐本机行的切换语义；缺省则主区纹丝不动） */
  onOpened?: () => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

/** 打开**远端** Agent 的常驻私聊（骑 owner 连接 ensure；会话开在远端网关）。 */
export async function openRemoteBotChat(
  row: UnionRosterRow,
  { onOpened, onError, onNotice }: OpenRemoteBotChatOptions = {},
): Promise<void> {
  if (!row.reachable) {
    onError?.(`远程连接「${row.connectionLabel}」当前不可达——无法就绪 @${row.entry.handle} 的 Bot Chat`);
    return;
  }

  try {
    // 🔴 round-54 P0：`requestForBot` 不注入 `params.profile`——此处显式传目标
    // profile，否则被 route.profile='default' 覆盖，远端建的是 default 的 Bot Chat
    const res = await requestForBot<{ session_id?: string }>(
      { connectionId: row.connectionId, profile: 'default' },
      'bot.chat.ensure',
      { profile: row.entry.profile },
      15_000,
    );

    markBotRead(row.entry.profile, res?.session_id || row.entry.canonical_session_id || undefined);

    if (res?.session_id) {
      // 点远端行 = **打开远端会话**（会话开在远端网关、行点击即达）；
      // 此前只 ensure + 弹 notice，用户看不见任何会话（round-76）
      openRemoteChat({
        connId: row.connectionId,
        profile: row.entry.profile,
        sessionId: res.session_id,
        label: row.connectionLabel || row.entry.handle,
      });
      onOpened?.();
    } else {
      onNotice?.(
        `已在远程连接「${row.connectionLabel}」就绪 @${row.entry.handle} 的 Bot Chat，` +
          `但未返回会话 id（跨网关私信仍可经 relay 管道投递：message_agent 目标用 @${row.entry.handle}@${row.connectionId}）`,
      );
    }
  } catch (e) {
    onError?.(`远程 Bot Chat 就绪失败：${(e as Error).message}`);
  }
}
