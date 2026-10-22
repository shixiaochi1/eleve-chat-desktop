/**
 * preview-status 单测 — R2.5 规范身份（对齐 Hermes previewArtifactKey）：
 * 同一文件两种写法 = 同一条 feed；dismiss 记忆按规范键不复活
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function memoryStorage() {
  let store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  }
}

describe('preview-status（R2.5 规范身份）', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function load() {
    return await import('./preview-status')
  }

  it('file:// URL 与 Windows 路径两写法 → 同一条 feed', async () => {
    const s = await load()
    s.recordPreviewArtifact('sid', 'file:///C:/proj/index.html', 'C:/other')
    s.recordPreviewArtifact('sid', 'C:\\proj\\index.html', 'C:/other')
    expect(s.getPreviewArtifacts('sid')).toHaveLength(1)
  })

  it('相对路径 ./x.html 与 x.html 同 cwd → 同一条', async () => {
    const s = await load()
    s.recordPreviewArtifact('sid', './x.html', 'C:/proj')
    s.recordPreviewArtifact('sid', 'x.html', 'C:/proj')
    expect(s.getPreviewArtifacts('sid')).toHaveLength(1)
  })

  it('含 .. 的相对路径折叠后与直连同身份', async () => {
    const s = await load()
    s.recordPreviewArtifact('sid', 'sub/../x.html', 'C:/proj')
    s.recordPreviewArtifact('sid', 'x.html', 'C:/proj')
    expect(s.getPreviewArtifacts('sid')).toHaveLength(1)
  })

  it('不同文件（同名不同目录）仍是两条 + label 逐层消歧（S3.5）', async () => {
    const s = await load()
    s.recordPreviewArtifact('sid', 'C:/a/index.html', 'C:/')
    s.recordPreviewArtifact('sid', 'C:/b/index.html', 'C:/')
    const items = s.getPreviewArtifacts('sid')
    expect(items).toHaveLength(2)
    expect(new Set(items.map((i) => i.label)).size).toBe(2)
  })

  it('dismiss（按规范 id）后重报不复活；发新消息解除', async () => {
    const s = await load()
    s.recordPreviewArtifact('sid', 'C:/p/x.html', 'C:/p')
    const item = s.getPreviewArtifacts('sid')[0]
    s.removePreviewArtifact('sid', item.id)
    // 两种写法重报都被挡（规范 id 已入 dismissed）
    s.recordPreviewArtifact('sid', 'C:/p/x.html', 'C:/p')
    s.recordPreviewArtifact('sid', 'file:///C:/p/x.html', 'C:/p')
    expect(s.getPreviewArtifacts('sid')).toHaveLength(0)
    // 新消息 → 解除 → 重报可见
    s.clearPreviewArtifacts('sid')
    s.recordPreviewArtifact('sid', 'C:/p/x.html', 'C:/p')
    expect(s.getPreviewArtifacts('sid')).toHaveLength(1)
  })

  it('每会话上限 4：最旧先出', async () => {
    const s = await load()
    for (let i = 0; i < 6; i += 1) s.recordPreviewArtifact('sid', `C:/p/f${i}.html`, 'C:/p')
    const items = s.getPreviewArtifacts('sid')
    expect(items).toHaveLength(4)
    expect(items[0].target).toBe('C:/p/f2.html')
  })
})
