import { describe, it, expect } from 'vitest'
import { computeTipPosition, fallbackAnchorRect } from './TipBubble'
import { layoutPresetToRail } from '@/lib/desktop-ui-events'

const viewport = { width: 1200, height: 800 }
const bubble = { width: 200, height: 60 }

describe('computeTipPosition（tip 气泡定位）', () => {
  it('空间足够时用首选边（top）', () => {
    const pos = computeTipPosition({ left: 400, top: 300, right: 800, bottom: 500 }, bubble, 'top', viewport)
    expect(pos.placement).toBe('top')
    expect(pos.top).toBe(300 - 12 - 60)
    expect(pos.left).toBe(400 + 200 - 100) // 水平居中
  })

  it('上方放不下 → 翻到下方', () => {
    const pos = computeTipPosition({ left: 400, top: 40, right: 800, bottom: 120 }, bubble, 'top', viewport)
    expect(pos.placement).toBe('bottom')
    expect(pos.top).toBe(132)
  })

  it('左右也放不下时退回首选边，且 left 被夹进视口', () => {
    const anchor = { left: 1180, top: 300, right: 1195, bottom: 340 }
    const pos = computeTipPosition(anchor, bubble, 'right', viewport)
    expect(pos.left).toBeLessThanOrEqual(viewport.width - bubble.width)
    expect(pos.left).toBeGreaterThanOrEqual(8)
  })

  it('垂直方向同样夹紧（不会跑到屏幕上方外）', () => {
    const pos = computeTipPosition({ left: 0, top: 0, right: 40, bottom: 20 }, { width: 100, height: 300 }, 'bottom', { width: 800, height: 200 })
    expect(pos.top).toBeGreaterThanOrEqual(8)
  })
})

describe('fallbackAnchorRect（锚点缺失时的区域回退）', () => {
  it('左栏类目标指向左缘，右栏类指向右缘', () => {
    const sessions = fallbackAnchorRect('sessions', { width: 1200, height: 800 })
    expect(sessions.left).toBe(8)
    const rail = fallbackAnchorRect('terminal', { width: 1200, height: 800 })
    expect(rail.right).toBe(1192)
    expect(rail.left).toBeGreaterThan(sessions.left)
  })
})

describe('layoutPresetToRail（apply_layout 预设）', () => {
  it('focus 关右栏并聚焦输入框', () => {
    expect(layoutPresetToRail('focus')).toEqual({ rightOpen: false, focusComposer: true })
  })
  it('default / 面板名开右栏', () => {
    expect(layoutPresetToRail('default')).toEqual({ rightOpen: true, rightTab: 'files' })
    expect(layoutPresetToRail('terminal')).toEqual({ rightOpen: true, rightTab: 'terminal' })
    expect(layoutPresetToRail('preview')).toEqual({ rightOpen: true, rightTab: 'preview' })
  })
  it('未知预设不猜 tab', () => {
    expect(layoutPresetToRail('quad')).toEqual({ rightOpen: true })
  })
})
