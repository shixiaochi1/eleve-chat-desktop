/**
 * cron-status — 定时任务**上次运行状态**的呈现判据（唯一真值）。
 *
 * 🔴 2026-09-15（对齐 Hermes cron 的状态呈现面）：后端 `last_status` 不再只有
 * `ok`/`error` 两档——投递面独立出了 `delivery_queued`（已入队、完成未证实）与
 * `delivery_failed`（agent 成功但结果没到用户手上）。Hermes 原文
 * （`hermes_cli/cron.py:167-183`）：
 *
 * ```python
 * if last_status == "ok": green "ok"
 * if last_status == "delivery_queued":
 *     yellow "delivery_queued: completion unverified; do not resend"
 * if last_status == "delivery_failed":
 *     # Agent succeeded but the result never reached the user — not green; last_error is None.
 *     yellow f"delivery_failed: {job.get('last_delivery_error') or '?'}"
 * else: red f"{last_status}: {job.get('last_error', '?')}"
 * ```
 *
 * 以及告警行（`hermes_cli/cron.py:216-233`）：`last_delivery_error` →
 * "⚠ Delivery failed:"；`last_delivery_unverified` → "⚠ Delivery UNVERIFIED:
 * adapter acked {targets} without message_id/raw_response"。
 *
 * 前端此前只认 `job.last_status === 'error'`（`CronPanel.tsx`）⇒ 投递失败/入队**什么都不显示**，
 * 用户会把"任务成功但通知没送达"读成正常。
 */

/** 与后端 `Job` 相关的呈现所需字段（结构化子集，便于单测） */
export interface CronStatusJob {
  last_status?: null | string
  last_error?: null | string
  last_delivery_error?: null | string
  last_delivery_unverified?: null | string[]
  /** 连续 run 本体失败次数（投递失败不计入；后端 `mark_job_run` 维护） */
  failure_streak?: null | number
}

export type CronStatusTone = 'danger' | 'ok' | 'warn'

export interface CronStatusDisplay {
  /** 悬停详情（错误原文；无则 undefined） */
  detail?: string
  /** 行内文案（对齐 Hermes 三档措辞） */
  label: string
  tone: CronStatusTone
}

/** 上次运行状态的徽章显示；无 `last_status`（从未跑过）⇒ null。 */
export function cronStatusDisplay(job: CronStatusJob): CronStatusDisplay | null {
  const status = job.last_status
  if (!status) return null
  if (status === 'ok') return { tone: 'ok', label: '上次成功' }
  if (status === 'delivery_queued') {
    // 入队 ≠ 完成：目标侧还在异步消费，重发会造成重复投递
    return {
      tone: 'warn',
      label: '已入队·未证实',
      detail: '结果已入队投递，但完成与否无法证实；请勿重发',
    }
  }
  if (status === 'delivery_failed') {
    // agent 成功、结果没送到用户——不是绿色，且 last_error 为空
    return {
      tone: 'warn',
      label: '投递失败',
      detail: job.last_delivery_error || '投递失败（无错误详情）',
    }
  }
  // error 及未知状态：红色 + run 本体的错误原因
  return {
    tone: 'danger',
    label: '上次失败',
    detail: job.last_error || undefined,
  }
}

/**
 * 连续失败提示（对齐 Hermes `hermes_cli/cron.py:176-180` 的 `streak >= 2`）：
 * 只有**连续**失败才提示——偶发一次失败不值得打扰，连续 2 次起说明任务真的坏了
 * （Hermes 同时还有 `cron.failure_nudge_threshold`（默认 3）的复查 nudge，见后端）。
 */
export function cronFailureStreakLabel(job: CronStatusJob): null | string {
  const streak = Number(job.failure_streak ?? 0)
  if (!Number.isFinite(streak) || streak < 2) return null
  return `连续失败 ${streak} 次`
}

/** 监测模式的呈现所需字段（结构化子集，便于单测） */
export interface CronMonitorJob {
  monitor_script?: null | string
  monitor_state?: null | {
    last_changed_at?: null | string
    last_output_hash?: null | string
  }
  monitor_url?: null | string
}

export interface CronMonitorDisplay {
  /** 悬停详情（源 + 语义 + 上次变化时间） */
  detail: string
  /** 'script' | 'url' */
  kind: 'script' | 'url'
  /** 行内文案 */
  label: string
  /** 监测源（脚本路径或 URL） */
  source: string
}

/**
 * 监测模式的徽章（对齐 Hermes `hermes_cli/cron.py:192-200 / 546-558`）：
 * `Monitor: {源} (agent runs only on output change)` + `Changed: {上次变化}`。
 *
 * 为什么要显示：挂了监测源的任务**不是每拍都跑 agent**——输出未变时整轮被抑制
 * （零 LLM、零投递）。若面板只说"每小时跑"，用户会以为模型每拍都在烧钱，
 * 或者反过来在"任务没动"时以为是坏了。无监测源 ⇒ null（不占位）。
 */
export function cronMonitorDisplay(job: CronMonitorJob): CronMonitorDisplay | null {
  const script = job.monitor_script || ''
  const url = job.monitor_url || ''
  const source = script || url
  if (!source) return null
  const kind: 'script' | 'url' = script ? 'script' : 'url'
  const changedAt = job.monitor_state?.last_changed_at || ''
  return {
    kind,
    source,
    label: '监测中',
    detail:
      `监测源：${source}\n` +
      '仅当输出变化时才唤起 Agent（未变则整轮跳过：不消耗模型、不投递）' +
      (changedAt ? `\n上次变化：${changedAt}` : '\n尚未检测到变化（等待首次基线）'),
  }
}

/** 告警行（对齐 Hermes `_job_warnings`）：投递失败 + 未证实目标。 */
export function cronJobWarnings(job: CronStatusJob): string[] {
  const lines: string[] = []
  if (job.last_delivery_error) lines.push(`⚠ 投递失败：${job.last_delivery_error}`)
  for (const target of job.last_delivery_unverified ?? []) {
    lines.push(`⚠ 未证实：${target}（适配器已接受但未返回消息 ID）`)
  }
  return lines
}
