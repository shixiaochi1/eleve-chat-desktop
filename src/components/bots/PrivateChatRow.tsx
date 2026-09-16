/**
 * PrivateChatRow — Agent 面板「③群聊 + 私聊区」私聊分组的行。
 *
 * 🔴 2026-09-17 round-116 P4.5（架构收敛）：从 components/BotsView.tsx 实体化到此处。
 * 此前本文件只是 BotsView 中 BotRosterRow 的再导出（新面板依赖旧文件）；
 * 定义落在这里后由 BotsView 反向再导出，旧调用点（BotsPane）零改动。
 *
 * 语义：一行 = 一个 Agent 的聊天入口（单击打开它的常驻私聊，不切身份）；
 * 运行态读数（活跃三路 / 未读 / attention / 卡死）由行内 hook 订阅，与卡片区
 * （身份档案，无运行态）刻意分工，抑制两处观感重复。
 *
 * 渲染逐字未改（仅函数改名）。
 */
import { cn } from '@/lib/utils';
import { attentionHint, attentionKey, useBotAttention } from '../../hooks/useBotAttention';
import { unreadKey, useBotUnread } from '../../hooks/useBotUnread';
import { botStalledSecs, isBotActive, isBotWorkerActive, isGatewayBusy } from '../../lib/bot-activity';
import type { UnionRosterRow } from '../../plugins/bots/state';

// ── 花名册单行（提取组件：未读点需 useBotUnread 订阅，hook 不能进 map） ──
// 未读点视觉语义对齐 SessionStatusDot 的 unread 变体（bg-success 稳态点）；
// 活动权威 = canonical Bot Chat（行点击打开的就是它，点与会话永不描述两回事）。
// 🔴 stage-3 UNION 行：远端行带连接标记（🏷 connectionLabel），拉取失败行
// 降级 ghost（opacity + 不可达提示），不消失（对齐 Hermes annotateBotSource）。
export function PrivateChatRow({ row, onOpen, onRowMenu, dimmed }: {
  row: UnionRosterRow;
  onOpen: () => void;
  onRowMenu: (x: number, y: number) => void;
  /** 🔴 round-109：已隐藏但在"显示已隐藏"下露出的行 —— 淡化而非消失
   *  （对齐 Hermes "reveal hidden bots (dimmed)"，与 RoomCard 同款 opacity-55）。 */
  dimmed?: boolean;
}) {
  const bot = row.entry;
  // 🔴 2026-09-05 round-54：未读键 = canonical_session_id ?? profile（与
  // useBotUnread.ingest 同一公式）——union 远端行的同名 profile 不再与本地
  // 行共用水位线；preview identity = click identity（锚定的就是行点击打开的会话）。
  const unread = useBotUnread(unreadKey(bot));
  // 🔴 round-104：该行是否需要用户介入（对齐 Hermes `$botAttention`）——
  // 键 = `${connectionId}::${profile}`，与 `services/bot-relay.ts` 投递结果
  // 写入口同源（远端行的同名 profile 不与本地行串味）。
  const attention = useBotAttention(attentionKey(row.connectionId, bot.profile));
  // 🔴 round-105：活跃指示——`BotRosterEntry.last_active` 此前**零消费**
  // （字段已由后端透传）。
  // 🔴 round-106：补上 Hermes 的**第二路**输入 `workerActive`——worker 会话
  // 不进会话列表，缺了这一路时跑 kanban 任务的 bot 会被显示成空闲（#90268）。
  // 🔴 2026-09-15（对齐 Hermes roster `botMood = workerActive || (本机 && gateway busy)`）：
  // gateway-busy 这一路此前**不可得**（见 `lib/bot-activity.ts` 文件头记录），现由后端
  // `bots.roster` 的 `busy`/`stalled_secs` 补上。stall 的**判据在后端** stall watcher
  // （`agent.session_stall_timeout_secs`），前端只呈现结果——不重复实现阈值。
  const workerActive = isBotWorkerActive(bot.worker_session);
  const gatewayBusy = isGatewayBusy(bot.busy);
  const stalledSecs = botStalledSecs(bot.stalled_secs);
  const botActive = isBotActive(bot.last_active) || workerActive || gatewayBusy;
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left',
        !row.reachable && 'opacity-40',
        dimmed && 'opacity-55',
      )}
      title={
        !row.reachable
          ? `远程连接「${row.connectionLabel}」不可达`
          : row.isRemote
            ? `远程 Agent（${row.connectionLabel}）——点击就绪其 Bot Chat`
            : `打开与 @${bot.handle} 的私聊`
      }
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onRowMenu(e.clientX, e.clientY); }}
    >
      <span className="relative shrink-0">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
          style={{ background: bot.color || 'var(--accent)' }}
        >
          {(bot.display_name || bot.handle).slice(0, 1).toUpperCase()}
        </span>
        {/* 🔴 round-105：活跃指示（对齐 Hermes bot-row 的状态点：
            贴在头像上。Hermes 的 `mood` 走 `BotFace（头像）的 work|idle`）。
            用与本面板同款的圆点（未读点也是 `bg-success`）+ 脉冲。
            🔴 round-106：worker 心跳同亮（Hermes `botMood` 的 `workerActive`
            一路）——此时语义是「正在干活」而非「刚刚聊过」。 */}
        {botActive && (
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card',
              // 卡死 ⇒ 红点且**不脉冲**（"动"是假象，正是要打破的错觉）
              stalledSecs !== null ? 'bg-destructive' : 'bg-success animate-pulse',
            )}
            title={
              stalledSecs !== null
                ? `会话可能卡住：${stalledSecs} 秒无进展（有排队消息未处理）`
                : workerActive
                  ? '正在执行任务'
                  : gatewayBusy
                    ? '正在运行一轮'
                    : '刚刚有活动'
            }
            aria-label={
              stalledSecs !== null
                ? '卡住'
                : workerActive
                  ? '正在执行任务'
                  : gatewayBusy
                    ? '正在运行'
                    : '活跃'
            }
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground truncate">{bot.display_name || bot.handle}</span>
        <span className="block text-xs text-muted-foreground truncate">
          @{bot.handle}
          {row.isRemote && (
            <span className={cn('ml-1.5 rounded px-1 py-px text-[10px]', row.reachable ? 'bg-accent/60 text-foreground' : 'bg-destructive/20 text-destructive')}>
              {row.connectionLabel}
            </span>
          )}
          {/* 🔴 round-78d：角色描述副行（对齐 Hermes roster role 行——后端
              round-54 已透传 description，此前前端类型未接、无处落地） */}
          {bot.description ? ` · ${bot.description}` : ''}
        </span>
      </span>
      {attention && (
        <span
          className="inline-flex items-center justify-center size-4 rounded-full bg-amber-500 text-white shrink-0 text-[10px] font-bold"
          role="status"
          title={attentionHint(attention)}
          aria-label={attentionHint(attention)}
        >
          !
        </span>
      )}
      {unread && (
        <span
          className="inline-block size-2 rounded-full bg-success shrink-0"
          role="status"
          title="有新的私聊消息"
          aria-label="有新的私聊消息"
        />
      )}
    </button>
  );
}

/** 旧名（BotsView 的再导出与 BotsPane 调用点仍在用；迁移完成后可删） */
export { PrivateChatRow as BotRosterRow };
