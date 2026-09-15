/**
 * cron-editor — 定时任务编辑器的**判据单点**（逐条对齐 Hermes 桌面
 * `apps/desktop/src/app/cron/cron-job-model.ts`）。
 *
 * 🔴 2026-09-15：ELEVE 的 CronPanel 此前把"必填校验 + payload 组装"内联在 `handleSave` 里
 * （`if (!name.trim() || !schedule.trim() || !prompt.trim()) return;`），带来两处与 Hermes 的偏差：
 * ① **script-only 任务（`no_agent=true` + `script`）永远存不了**——它本来就没有 prompt，
 *    而 Hermes 明确允许（*"Script-only cron jobs run a shell script on schedule with no LLM
 *    prompt"*）；
 * ② 校验失败是**静默 return**（点保存没反应），而 Hermes 会区分
 *    `prompt` / `schedule` / `prompt_and_schedule` 三种错误给用户看。
 *
 * 另：Hermes 编辑器还带 `model` / `provider` 两个字段（"跟随默认"= 留空），ELEVE 的表单此前没有。
 */

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export interface CronEditorJob {
  deliver?: null | string
  model?: null | string
  no_agent?: null | boolean
  prompt?: null | string
  provider?: null | string
  script?: null | string
  schedule_display?: null | string
}

/** Script-only cron jobs run a shell script on schedule with no LLM prompt. */
export function jobIsScriptOnly(job: Pick<CronEditorJob, 'no_agent' | 'script'>): boolean {
  return Boolean(job.no_agent) && Boolean(asText(job.script).trim())
}

export type CronEditorValidationError = 'prompt' | 'prompt_and_schedule' | 'schedule'

export interface CronEditorValidationInput {
  prompt: string
  schedule: string
  scriptOnlyJob: boolean
}

export function validateCronEditor(input: CronEditorValidationInput): CronEditorValidationError | null {
  const trimmedPrompt = input.prompt.trim()
  const trimmedSchedule = input.schedule.trim()

  if (!trimmedSchedule && !trimmedPrompt && !input.scriptOnlyJob) return 'prompt_and_schedule'
  if (!trimmedSchedule) return 'schedule'
  if (!input.scriptOnlyJob && !trimmedPrompt) return 'prompt'

  return null
}

/** 校验错误 → 可直接展示的中文文案（Hermes 的三种错误一一对应）。 */
export function cronEditorValidationMessage(error: CronEditorValidationError): string {
  switch (error) {
    case 'prompt_and_schedule':
      return '请填写执行频率与提示词（脚本任务还需指定脚本）'
    case 'schedule':
      return '请填写执行频率'
    default:
      return '请填写提示词（脚本任务可留空）'
  }
}

export interface CronEditorValues {
  deliver: string
  /** 每个任务的模型覆盖（'' = 开火时跟随全局默认） */
  model: string
  name: string
  prompt: string
  /** 模型覆盖的 provider（'' = 不指定）；与 model 成对出现 */
  provider: string
  schedule: string
}

/** 组装 update/create 的 payload（对齐 Hermes `cronEditorUpdates`）。 */
export interface CronEditorUpdates {
  deliver: string
  model?: null | string
  name: string
  prompt?: string
  provider?: null | string
  schedule: string
}

export function cronEditorUpdates(
  values: CronEditorValues,
  options: { scriptOnlyJob: boolean },
): CronEditorUpdates {
  const updates: CronEditorUpdates = {
    deliver: values.deliver,
    name: values.name,
    schedule: values.schedule.trim(),
  }

  const trimmedPrompt = values.prompt.trim()

  // 🔴 script-only 任务的 prompt 允许为空，且**空时不写**（保留库里的原值）
  // （Hermes：*"preserving an empty prompt on script-only jobs"*）
  if (!options.scriptOnlyJob || trimmedPrompt) {
    updates.prompt = trimmedPrompt
  }

  // 🔴 Script-only jobs never run an agent, so the scheduler ignores model
  // overrides — leave whatever is stored untouched. For agent jobs, always
  // write both axes so resetting to "default" clears a previous pin (the
  // backend normalizes null/'' to "no override").
  if (!options.scriptOnlyJob) {
    updates.model = values.model.trim() || null
    updates.provider = values.provider.trim() || null
  }

  return updates
}
