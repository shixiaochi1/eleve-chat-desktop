import { describe, expect, it } from 'vitest'

import {
  cronEditorUpdates,
  jobIsScriptOnly,
  validateCronEditor,
  type CronEditorValues,
} from './cron-editor'

const values = (over: Partial<CronEditorValues> = {}): CronEditorValues => ({
  name: 'job',
  schedule: '0 9 * * *',
  prompt: 'do it',
  deliver: 'local',
  model: '',
  provider: '',
  ...over,
})

describe('jobIsScriptOnly', () => {
  it('no_agent + script 才算脚本任务', () => {
    expect(jobIsScriptOnly({ no_agent: true, script: 'check.sh' })).toBe(true)
    expect(jobIsScriptOnly({ no_agent: true, script: '   ' })).toBe(false)
    expect(jobIsScriptOnly({ no_agent: true })).toBe(false)
    expect(jobIsScriptOnly({ no_agent: false, script: 'check.sh' })).toBe(false)
    expect(jobIsScriptOnly({})).toBe(false)
  })
})

describe('validateCronEditor', () => {
  it('普通任务缺提示词 ⇒ prompt；缺频率 ⇒ schedule；两者都缺 ⇒ prompt_and_schedule', () => {
    expect(validateCronEditor({ prompt: '   ', schedule: '0 9 * * *', scriptOnlyJob: false })).toBe('prompt')
    expect(validateCronEditor({ prompt: 'x', schedule: '  ', scriptOnlyJob: false })).toBe('schedule')
    expect(validateCronEditor({ prompt: '', schedule: '', scriptOnlyJob: false })).toBe('prompt_and_schedule')
    expect(validateCronEditor({ prompt: 'x', schedule: '0 9 * * *', scriptOnlyJob: false })).toBeNull()
  })

  it('脚本任务允许空提示词，但频率仍必填', () => {
    expect(validateCronEditor({ prompt: '', schedule: 'every 5m', scriptOnlyJob: true })).toBeNull()
    expect(validateCronEditor({ prompt: '', schedule: '', scriptOnlyJob: true })).toBe('schedule')
  })
})

describe('cronEditorUpdates', () => {
  it('总是带上 name/schedule/deliver，并写入两轴 model/provider（空 ⇒ null 清掉旧 pin）', () => {
    const updates = cronEditorUpdates(values({ model: ' gpt-x ', provider: 'openai' }), {
      scriptOnlyJob: false,
    })
    expect(updates.name).toBe('job')
    expect(updates.schedule).toBe('0 9 * * *')
    expect(updates.prompt).toBe('do it')
    expect(updates.model).toBe('gpt-x')
    expect(updates.provider).toBe('openai')

    // 重置为"跟随默认" ⇒ 显式 null（后端把 null/'' 归一为"无覆盖"），否则旧 pin 会留下
    const reset = cronEditorUpdates(values({ model: '', provider: '' }), { scriptOnlyJob: false })
    expect(reset.model).toBeNull()
    expect(reset.provider).toBeNull()
  })

  it('脚本任务：不写 model/provider（调度器忽略），且空提示词时不写 prompt', () => {
    const updates = cronEditorUpdates(values({ prompt: '  ', model: 'pinned', provider: 'x' }), {
      scriptOnlyJob: true,
    })
    expect(updates.model).toBeUndefined()
    expect(updates.provider).toBeUndefined()
    expect(updates.prompt).toBeUndefined()

    // 脚本任务若真的填了提示词，则照写
    const withPrompt = cronEditorUpdates(values({ prompt: ' note ' }), { scriptOnlyJob: true })
    expect(withPrompt.prompt).toBe('note')
  })
})
