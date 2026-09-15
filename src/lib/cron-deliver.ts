/**
 * cron-deliver — 投递目标的**多选判据**（对齐 Hermes 桌面
 * `apps/desktop/src/app/cron/cron-job-model.ts` 的 `parseCronDeliveryTargets` /
 * `toggleCronDeliveryTarget`，以及后端 `_resolve_delivery_targets` 的逗号多目标语义）。
 *
 * 🔴 2026-09-15：ELEVE 的"发送到"此前是**单选 `<select>`**，而 Hermes 的 `deliver` 本来就是
 * **逗号组合的多目标**（后端 `_resolve_delivery_targets` 逐段解析、去重、支持 `all`）⇒
 * 桌面表达不了"同时发 Telegram 和 Discord"。
 *
 * ELEVE 化的一处（Hermes 的 checkbox 组没做这个互斥）：本仓的 `local` 语义是"**只存不发**"，
 * 与任何具体平台互斥 ⇒ 勾 `local` 清掉平台、勾平台清掉 `local`；且**至少保留一个**
 * （与 Hermes 的"最后一个不可取消"保护同构）。
 */

/** 解析逗号组合的投递目标；空/全空 ⇒ 回落 `['local']`（对齐 Hermes）。 */
export function parseCronDeliveryTargets(value: string): string[] {
  const targets = value
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)

  return targets.length > 0 ? [...new Set(targets)] : ['local']
}

/** 勾选/取消一个投递目标，返回新的逗号组合（去重、保序、至少留一个）。 */
export function toggleCronDeliveryTarget(value: string, target: string, checked: boolean): string {
  const targets = parseCronDeliveryTargets(value)

  if (checked) {
    // 勾 `local` ⇒ 只留 local（互斥）；勾平台 ⇒ 先摘掉 local 再并入
    if (target === 'local') return 'local'
    const withoutLocal = targets.filter((candidate) => candidate !== 'local')
    return withoutLocal.includes(target) ? withoutLocal.join(',') : [...withoutLocal, target].join(',')
  }

  // 至少保留一个（Hermes：`|| targets.length === 1` ⇒ 不取消最后一个）
  if (!targets.includes(target) || targets.length === 1) return targets.join(',')

  return targets.filter((candidate) => candidate !== target).join(',')
}

/** 人类可读的多目标摘要（"Telegram + Discord"），供卡片与表单回显。 */
export function describeCronDeliveryTargets(
  value: string | null | undefined,
  labelOf: (target: string) => string,
): string {
  return parseCronDeliveryTargets(value ?? '')
    .map(labelOf)
    .join(' + ')
}
