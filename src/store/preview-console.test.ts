/**
 * preview-console 单测 — S1.2 per-tab 存活 + S1.3 截断/逐出/selected 修剪
 * （对齐 Hermes preview-console-state.ts 三级上限 + preview-console-store.ts）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createPreviewConsoleState,
  getPreviewConsoleState,
  releasePreviewConsoleState,
} from './preview-console'

describe('createPreviewConsoleState（S1.3 截断治理）', () => {
  it('单条 message 超 64KB 截断', () => {
    const s = createPreviewConsoleState()
    s.append({ level: 0, message: 'x'.repeat(100 * 1024) })
    expect(s.getLogs()[0].message.length).toBeLessThanOrEqual(64 * 1024)
    expect(s.getLogs()[0].message.length).toBeGreaterThan(63 * 1024)
  })

  it('截断不切分 UTF-16 代理对（emoji 不成半）', () => {
    const s = createPreviewConsoleState()
    // 33KB emoji = 67584 UTF-16 码元 / 135168 UTF-8 字节 > 64KB 上限 → 必截断
    s.append({ level: 0, message: '🎉'.repeat(33 * 1024) })
    const msg = s.getLogs()[0].message
    // 截断点安全 = 末位不是高位代理（切半会留下孤立的 [0xD800-0xDBFF]）
    const last = msg.charCodeAt(msg.length - 1)
    expect(last >= 0xdc00 && last <= 0xdfff).toBe(true)
  })

  it('条数上限 200：最旧先逐出', () => {
    const s = createPreviewConsoleState()
    for (let i = 0; i < 250; i += 1) s.append({ level: 0, message: `m${i}` })
    expect(s.getLogCount()).toBe(200)
    expect(s.getLogs()[0].message).toBe('m50')
    expect(s.getLogs()[199].message).toBe('m249')
  })

  it('被逐出条目的 selected id 修剪（防「已选 N 条」虚高）', () => {
    const s = createPreviewConsoleState()
    s.append({ level: 0, message: 'first' })
    s.toggleSelection(s.getLogs()[0].id)
    expect(s.getSelectedLogIds().size).toBe(1)
    for (let i = 0; i < 250; i += 1) s.append({ level: 0, message: `m${i}` })
    // 'first' 已被逐出 → 选中集必须清空
    expect(s.getSelectedLogIds().size).toBe(0)
  })

  it('总量 512KB 超限从最旧逐出', () => {
    const s = createPreviewConsoleState()
    // 10 条 60KB message（每条 < 64KB 单条上限）= 600KB 总量 > 512KB
    for (let i = 0; i < 10; i += 1) s.append({ level: 0, message: 'y'.repeat(60 * 1024) })
    expect(s.getLogCount()).toBeLessThan(10)
    expect(s.getLogCount()).toBeGreaterThanOrEqual(8)
  })

  it('replace 全量替换清空选中 + 重新编号', () => {
    const s = createPreviewConsoleState()
    s.append({ level: 1, message: 'a' })
    s.toggleSelection(s.getLogs()[0].id)
    s.replace([{ level: 0, message: 'r0' }, { level: 0, message: 'r1' }])
    expect(s.getLogCount()).toBe(2)
    expect(s.getSelectedLogIds().size).toBe(0)
    expect(s.getLogs().map((e) => e.id)).toEqual([1, 2])
  })
})

describe('per-tab 存活注册表（S1.2）', () => {
  beforeEach(() => {
    releasePreviewConsoleState('tab-a')
    releasePreviewConsoleState('tab-b')
  })

  it('同 tabId 返回同一实例（日志跨卸载存活）', () => {
    const first = getPreviewConsoleState('tab-a')
    first.append({ level: 0, message: 'persisted' })
    expect(getPreviewConsoleState('tab-a')).toBe(first)
    expect(getPreviewConsoleState('tab-a').getLogs().length).toBe(1)
  })

  it('不同 tabId 各自独立', () => {
    getPreviewConsoleState('tab-a').append({ level: 0, message: 'a' })
    getPreviewConsoleState('tab-b').append({ level: 0, message: 'b' })
    expect(getPreviewConsoleState('tab-a').getLogs()[0].message).toBe('a')
    expect(getPreviewConsoleState('tab-b').getLogs()[0].message).toBe('b')
  })

  it('release 后重新 get 是全新实例（tab 关闭即释放）', () => {
    getPreviewConsoleState('tab-a').append({ level: 0, message: 'gone' })
    releasePreviewConsoleState('tab-a')
    expect(getPreviewConsoleState('tab-a').getLogs().length).toBe(0)
  })
})
