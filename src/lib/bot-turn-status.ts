/**
 * 群聊「轮终态」的**唯一呈现词表**（词条 + 档位）。
 *
 * 对齐 Hermes `plugins/hermes-bots/group-activity.ts`：
 * - `GROUP_ACTIVITY_LABELS`：12 个 kind 的中性词条
 * - `groupActivityTone(kind)`：kind → 三档呈现。Hermes 原文注释：
 *   *"quiet for pass/cancel/settle, accent for work and real replies,
 *     destructive for failures and timeouts."*
 *
 * ```
 * failed / timed-out            → destructive
 * working / replied / delivered → accent
 * 其余（passed/cancelled/held/capped/settled/queued/stopped）→ quiet
 * ```
 *
 * 🔴 round-99 纠正 round-98 的一处**过度延伸**：
 * round-98 确立了"轮超时 = 缺席，不是故障"的**行为语义**（不中断在飞轮、
 * 迟到的回信由收割补投、活动层读作 pass）——这部分是对的。但当时把这条
 * 语义**延伸到了视觉层**，让超时行"不标红"。
 *
 * Hermes 的两层是分开的：行为上超时不中断（`group-turns.ts:781-798`），
 * 视觉上 `timed-out` 与 `failed` **同为 `text-destructive`**
 * （`group-activity.ts:119-124`）。故此处恢复：**超时 = destructive**。
 * 文案仍用中性措辞（对齐 Hermes 的 `'took too long'`），不写"故障"。
 *
 * ⚠️ 对齐的是**语义分类与档位**，不是字符串：Hermes 的 activity 是
 * **房间 run 级**（`cancelled`/`settled`/`capped` 的 label 不带成员名），
 * ELEVE 这两处渲染是**成员轮级**（都冠以 `@handle`）。故词条用 ELEVE 既有
 * 中文表达，语义逐条对齐。
 */

/** 呈现档位（对齐 Hermes `groupActivityTone` 的三档）。 */
export type TurnTone = 'destructive' | 'accent' | 'quiet';

export interface TurnStatus {
  /** 词条，**不含成员名**——调用方按 `${who} ${label}` 拼接。 */
  label: string;
  tone: TurnTone;
  /** 是否可显式重试（只有非超时的缺席才给——超时的会话还在跑，重试会双注入）。 */
  retryable: boolean;
}

/** deadline 缺席的原因码（后端 round-81 的结构化审计字段）。 */
export const REASON_DEADLINE = 'turn_deadline_exceeded';

/** 该缺席是否由**轮预算耗尽**（超时）造成——超时与"成员不可用"是两种缺席。 */
export function isDeadlineReason(reasonCode: unknown): boolean {
  return reasonCode === REASON_DEADLINE;
}

/** 档位 → class（两处渲染共用；quiet 是基线，accent/destructive 是例外）。 */
export function turnToneClass(tone: TurnTone): string {
  switch (tone) {
    case 'destructive':
      return 'text-destructive/80';
    case 'accent':
      return 'text-foreground';
    case 'quiet':
      return 'text-muted-foreground/70';
  }
}

/**
 * 成员轮终态 / 房间级活动标记 → 呈现词条。
 * 返回 `null` = 该 kind 不渲染（把"什么该出现在日志里"也收在这一处）。
 *
 * 覆盖 ELEVE 的全部 6 个轮终态 + 房间级 `room.activity`（bounded）。
 */
export function turnStatusOf(
  kind: string,
  payload?: Record<string, unknown> | null,
): TurnStatus | null {
  const reason = payload?.reason_code;
  switch (kind) {
    case 'turn.settled':
      // Hermes: passed → 'passed'（quiet）／replied → 'replied'（accent）
      return payload?.passed === true
        ? { label: '跳过本轮', tone: 'quiet', retryable: false }
        : { label: '已回复', tone: 'accent', retryable: false };

    case 'turn.failed':
      // Hermes: failed → 'hit an error'（destructive）
      return { label: '出错', tone: 'destructive', retryable: false };

    case 'turn.cancelled':
      // Hermes: cancelled → 'turn interrupted by a newer message'（quiet）
      return { label: '轮被新消息打断', tone: 'quiet', retryable: false };

    case 'turn.deferred': {
      // Hermes: timed-out → 'took too long'（**destructive**）
      if (isDeadlineReason(reason)) {
        return { label: '超时（回复迟到时会补投）', tone: 'destructive', retryable: false };
      }
      // 其余缺席（成员不可用/投递失败）同样 destructive；给显式重试。
      return { label: '暂时缺席', tone: 'destructive', retryable: true };
    }

    case 'turn.held':
      // Hermes: held → 'is held (stopped by you) — @mention it or say resume to release'
      return { label: '已暂停发言', tone: 'quiet', retryable: false };

    case 'room.activity': {
      // 🔴 round-99：`bounded` 此前**前端零消费**——讨论撞上轮数/消息数上限后
      // 静默停止，用户只看到"没人再回复"却不知为何。它是唯一只存在于房间级、
      // 没有成员级对应物的活动，所以最容易被漏掉。
      // 对齐 Hermes: capped → 'turn stopped at the round/message cap'（quiet）。
      if (payload?.status !== 'bounded') return null;
      const label =
        reason === 'max_rounds'
          ? '讨论达到轮数上限而停止'
          : reason === 'max_messages'
            ? '讨论达到消息数上限而停止'
            : '讨论达到上限而停止';
      return { label, tone: 'quiet', retryable: false };
    }

    default:
      return null;
  }
}

/** `room.activity` 的 bounded 标记是否该进日志（供"是否有话要说"的快速判定）。 */
export function isRoomBoundedActivity(kind: string, payload?: Record<string, unknown> | null): boolean {
  return kind === 'room.activity' && payload?.status === 'bounded';
}
