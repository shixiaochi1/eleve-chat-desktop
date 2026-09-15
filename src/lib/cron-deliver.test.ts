import { describe, expect, it } from 'vitest'

import {
  describeCronDeliveryTargets,
  parseCronDeliveryTargets,
  toggleCronDeliveryTarget,
} from './cron-deliver'

describe('parseCronDeliveryTargets', () => {
  it('拆逗号、去重、保序；空值回落 local', () => {
    expect(parseCronDeliveryTargets('telegram,discord')).toEqual(['telegram', 'discord'])
    expect(parseCronDeliveryTargets(' telegram , discord ')).toEqual(['telegram', 'discord'])
    expect(parseCronDeliveryTargets('telegram,telegram')).toEqual(['telegram'])
    expect(parseCronDeliveryTargets('')).toEqual(['local'])
    expect(parseCronDeliveryTargets(' , ')).toEqual(['local'])
  })
})

describe('toggleCronDeliveryTarget', () => {
  it('勾选平台 ⇒ 并入并摘掉 local（互斥）', () => {
    expect(toggleCronDeliveryTarget('local', 'telegram', true)).toBe('telegram')
    expect(toggleCronDeliveryTarget('telegram', 'discord', true)).toBe('telegram,discord')
    // 已在列表里 ⇒ 不重复
    expect(toggleCronDeliveryTarget('telegram,discord', 'telegram', true)).toBe('telegram,discord')
  })

  it('勾选 local ⇒ 只留 local', () => {
    expect(toggleCronDeliveryTarget('telegram,discord', 'local', true)).toBe('local')
  })

  it('取消：至少保留一个（对齐 Hermes "最后一个不可取消"）', () => {
    expect(toggleCronDeliveryTarget('telegram,discord', 'telegram', false)).toBe('discord')
    expect(toggleCronDeliveryTarget('local', 'local', false)).toBe('local')
    // 取消一个不在列表里的目标 ⇒ 原样
    expect(toggleCronDeliveryTarget('telegram', 'discord', false)).toBe('telegram')
  })
})

describe('describeCronDeliveryTargets', () => {
  it('多目标摘要用 + 连接', () => {
    const labelOf = (t: string) => (t === 'local' ? '此桌面' : t)
    expect(describeCronDeliveryTargets('telegram,discord', labelOf)).toBe('telegram + discord')
    expect(describeCronDeliveryTargets(null, labelOf)).toBe('此桌面')
  })
})
