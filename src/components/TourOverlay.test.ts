import { describe, it, expect } from 'vitest'
import { clampStepIndex, stepCounter } from './TourOverlay'
import { parseTourSteps } from '@/lib/desktop-ui-events'

describe('clampStepIndex / stepCounter（tour 翻页）', () => {
  it('越界夹紧，空列表回到 0', () => {
    expect(clampStepIndex(-3, 4)).toBe(0)
    expect(clampStepIndex(2, 4)).toBe(2)
    expect(clampStepIndex(9, 4)).toBe(3)
    expect(clampStepIndex(0, 0)).toBe(0)
  })

  it('页码是 1-based 且不超过总数', () => {
    expect(stepCounter(0, 3)).toBe('1 / 3')
    expect(stepCounter(2, 3)).toBe('3 / 3')
    expect(stepCounter(8, 3)).toBe('3 / 3')
  })
})

describe('parseTourSteps（tour.start 负载归一）', () => {
  it('保留合法步骤并小写 target', () => {
    const steps = parseTourSteps([
      { target: 'Composer', text: ' 在这里提问 ', title: '输入框' },
      { target: 'terminal', text: '看后台输出', side: 'left' },
    ])
    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({ target: 'composer', text: '在这里提问', title: '输入框', side: undefined })
    expect(steps[1].side).toBe('left')
  })

  it('缺 target/text 的条目被丢弃，非数组输入返回空', () => {
    expect(parseTourSteps([{ target: 'composer' }, { text: 'x' }, null, 42])).toEqual([])
    expect(parseTourSteps(undefined)).toEqual([])
    expect(parseTourSteps({ steps: [] })).toEqual([])
  })
})
