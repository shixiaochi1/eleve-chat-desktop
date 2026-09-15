import { describe, expect, it } from 'vitest'

import {
  cronFailureStreakLabel,
  cronJobWarnings,
  cronMonitorDisplay,
  cronStatusDisplay,
} from './cron-status'

describe('cronMonitorDisplay', () => {
  it('无监测源 ⇒ 不占位', () => {
    expect(cronMonitorDisplay({})).toBeNull()
    expect(cronMonitorDisplay({ monitor_script: '' })).toBeNull()
    expect(cronMonitorDisplay({ monitor_url: '' })).toBeNull()
  })

  it('脚本源 ⇒ 显示脚本类型，详情说明"未变则整轮跳过"（含首次基线文案）', () => {
    const d = cronMonitorDisplay({ monitor_script: 'watch.sh' })
    expect(d?.kind).toBe('script')
    expect(d?.label).toBe('监测中')
    expect(d?.detail).toContain('watch.sh')
    expect(d?.detail).toContain('不消耗模型')
    expect(d?.detail).toContain('尚未检测到变化')
  })

  it('URL 源 + 有变化时间 ⇒ 显示 URL 类型与上次变化时间', () => {
    const d = cronMonitorDisplay({
      monitor_url: 'https://example.com/x',
      monitor_state: { last_changed_at: '2026-09-15T10:00:00Z' },
    })
    expect(d?.kind).toBe('url')
    expect(d?.detail).toContain('https://example.com/x')
    expect(d?.detail).toContain('2026-09-15T10:00:00Z')
  })

  it('两源同时存在（异常数据）⇒ 脚本优先（与后端 monitor_script 优先一致）', () => {
    expect(cronMonitorDisplay({ monitor_script: 'a.sh', monitor_url: 'https://x' })?.kind).toBe(
      'script',
    )
  })
})

describe('cronStatusDisplay', () => {
  it('从未运行（无 last_status）不显示徽章', () => {
    expect(cronStatusDisplay({})).toBeNull()
    expect(cronStatusDisplay({ last_status: null })).toBeNull()
  })

  it('ok ⇒ 绿色成功', () => {
    expect(cronStatusDisplay({ last_status: 'ok' })).toEqual({ tone: 'ok', label: '上次成功' })
  })

  it('delivery_queued ⇒ 黄色"已入队·未证实"（入队 ≠ 完成，且提示勿重发）', () => {
    const d = cronStatusDisplay({ last_status: 'delivery_queued' })
    expect(d?.tone).toBe('warn')
    expect(d?.label).toContain('未证实')
    expect(d?.detail).toContain('请勿重发')
  })

  it('delivery_failed ⇒ 黄色"投递失败"，详情取 last_delivery_error（绝不当成功）', () => {
    const d = cronStatusDisplay({
      last_status: 'delivery_failed',
      last_delivery_error: 'telegram 400: chat not found',
      // 投递失败时 last_error 为空（Hermes：last_error is None for these runs）
      last_error: null,
    })
    expect(d?.tone).toBe('warn')
    expect(d?.label).toBe('投递失败')
    expect(d?.detail).toBe('telegram 400: chat not found')
    expect(d?.tone).not.toBe('ok')
  })

  it('error / 未知状态 ⇒ 红色，详情取 last_error', () => {
    expect(cronStatusDisplay({ last_status: 'error', last_error: 'boom' })).toEqual({
      tone: 'danger',
      label: '上次失败',
      detail: 'boom',
    })
    // 未知状态同样按失败呈现（不静默成成功）
    expect(cronStatusDisplay({ last_status: 'blocked_config' })?.tone).toBe('danger')
  })
})

describe('cronFailureStreakLabel', () => {
  it('连续失败 ≥2 才提示（偶发一次不打扰）', () => {
    expect(cronFailureStreakLabel({})).toBeNull()
    expect(cronFailureStreakLabel({ failure_streak: 1 })).toBeNull()
    expect(cronFailureStreakLabel({ failure_streak: 2 })).toBe('连续失败 2 次')
    expect(cronFailureStreakLabel({ failure_streak: 7 })).toBe('连续失败 7 次')
  })

  it('脏数据不崩（null / NaN / 负值）', () => {
    expect(cronFailureStreakLabel({ failure_streak: null })).toBeNull()
    expect(cronFailureStreakLabel({ failure_streak: Number.NaN })).toBeNull()
    expect(cronFailureStreakLabel({ failure_streak: -3 })).toBeNull()
  })
})

describe('cronJobWarnings', () => {
  it('投递失败与未证实目标各自成行；未证实**不影响**状态徽章', () => {
    expect(cronJobWarnings({ last_delivery_error: 'webhook 500' })).toEqual(['⚠ 投递失败：webhook 500'])
    expect(
      cronJobWarnings({ last_delivery_unverified: ['slack:C123', 'matrix:!room'] }),
    ).toEqual([
      '⚠ 未证实：slack:C123（适配器已接受但未返回消息 ID）',
      '⚠ 未证实：matrix:!room（适配器已接受但未返回消息 ID）',
    ])
    // ack 无证据仍算投达：status=ok 时徽章为成功，但告警行仍在
    expect(cronStatusDisplay({ last_status: 'ok' })?.tone).toBe('ok')
  })

  it('无告警时返回空数组', () => {
    expect(cronJobWarnings({ last_status: 'ok' })).toEqual([])
  })
})
