/**
 * preview store 单测 — S2.3 withRenderMode / S3.2 canonicalFileKey /
 * S2.2 missing 墓碑持久化剥离
 *
 * node 环境无 localStorage → store 侧已静默降级纯运行时；持久化断言用
 * vi.stubGlobal 注入内存实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 内存 localStorage（持久化断言用）
function memoryStorage() {
  let store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    _dump: () => store,
  }
}

describe('preview store（S2.3/S3.2/S2.2）', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadStore() {
    return await import('./preview')
  }

  it('S3.2 canonicalFileKey：路径与 file:// URL 是同一文件 → 复用同一 tab', async () => {
    const store = await loadStore()
    const id1 = store.openPreview({ kind: 'file', url: 'C:\\proj\\index.html', previewKind: 'html' })
    const id2 = store.openPreview({ kind: 'file', url: 'file:///C:/proj/index.html', previewKind: 'html' })
    expect(id2).toBe(id1)
    expect(store.getPreviewStoreState().tabs.filter((t) => t.target.kind === 'file')).toHaveLength(1)
  })

  it('S3.2：反斜杠/正斜杠/.. 写法经归一化后同文件复用 tab（S0.2 联动）', async () => {
    const [store, local] = await Promise.all([loadStore(), import('@/lib/local-preview')])
    // 真实链路：.. 在 normalize 层折叠（S0.2），canonical 层折叠路径分隔与 file:// 前缀
    const rel = local.normalizeOrLocalPreviewTarget('x/../index.html', 'C:/proj')
    const winAbs = local.normalizeOrLocalPreviewTarget('C:\\proj\\index.html')
    expect(rel && winAbs).toBeTruthy()
    const id1 = store.openPreview(rel!)
    const id2 = store.openPreview(winAbs!)
    expect(id2).toBe(id1)
  })

  it('S2.3 withRenderMode：HTML 全新打开默认渲染，re-open 保留已选模式', async () => {
    const store = await loadStore()
    const target = { kind: 'file' as const, url: 'C:/p/a.html', previewKind: 'html' as const }
    // 全新 → 默认 preview
    store.openPreview(target)
    let tab = store.getPreviewStoreState().tabs[0]
    expect(tab.target.renderMode).toBe('preview')
    // 显式 source 打开（用户从别处带模式来）→ 尊重显式值
    store.openPreview({ ...target, renderMode: 'source' })
    tab = store.getPreviewStoreState().tabs[0]
    expect(tab.target.renderMode).toBe('source')
    // 再无模式 re-open → 保留 existing 的 source（不回退 preview）
    store.openPreview(target)
    tab = store.getPreviewStoreState().tabs[0]
    expect(tab.target.renderMode).toBe('source')
  })

  it('S2.3 renderedHtmlTarget：agent 交付强制渲染（即使 tab 停在 Source）', async () => {
    const store = await loadStore()
    const target = { kind: 'file' as const, url: 'C:/p/b.html', previewKind: 'html' as const }
    store.openPreview({ ...target, renderMode: 'source' })
    store.openPreview(store.renderedHtmlTarget(target))
    expect(store.getPreviewStoreState().tabs[0].target.renderMode).toBe('preview')
  })

  it('S2.2 missing 墓碑：标记后 tab 留存 + 持久化剥离 + 可清除', async () => {
    const store = await loadStore()
    const id = store.openPreview({ kind: 'file', url: 'C:/p/gone.html' })
    store.markPreviewTabMissing(id)
    let state = store.getPreviewStoreState()
    expect(state.tabs[0].target.missing).toBe(true)
    // 持久化剥离：唯一 tab 被剥 → 键整个移除（raw 为 null 即证明）
    const raw = localStorage.getItem('eleve.previewTabs.v1')
    expect(raw).toBeNull()
    // 清除（手动重载恢复通道）
    store.clearPreviewTabMissing(id)
    state = store.getPreviewStoreState()
    expect(state.tabs[0].target.missing).toBeFalsy()
  })

  it('S1：closeTab 释放 per-tab console（防 Map 泄漏）', async () => {
    const [store, consoleStore] = await Promise.all([loadStore(), import('./preview-console')])
    const id = store.openPreview({ kind: 'file', url: 'C:/p/c.html' })
    consoleStore.getPreviewConsoleState(id).append({ level: 0, message: 'x' })
    store.closeTab(id)
    expect(consoleStore.getPreviewConsoleState(id).getLogs().length).toBe(0)
  })

  it('R2.4 togglePreviewTab 身份级开关：alternate 拼写也能关掉（file canonical）', async () => {
    const store = await loadStore()
    store.togglePreviewTab('C:\\p\\a.html', undefined)
    expect(store.getPreviewStoreState().tabs).toHaveLength(1)
    expect(store.isPreviewOpenFor('C:/p/a.html')).toBe(true)
    expect(store.isPreviewOpenFor('file:///C:/p/a.html')).toBe(true)
    // 换拼写再 toggle → 关的是同一个 tab（旧字符串匹配法关不掉）
    store.togglePreviewTab('file:///C:/p/a.html', undefined)
    expect(store.getPreviewStoreState().tabs).toHaveLength(0)
    expect(store.isPreviewOpenFor('C:/p/a.html')).toBe(false)
  })

  it('R2.4 togglePreviewTab url 双匹配：打开时地址与 live page 都能关（对齐 Hermes 按 source 判断 + live-url 匹配）', async () => {
    const store = await loadStore()
    store.togglePreviewTab('http://localhost:5173/', undefined)
    let tab = store.getPreviewStoreState().tabs[0]
    // 页面内导航到别的地址（browserPages 回写）
    store.commitBrowserPage(tab.id, 'http://localhost:5173/dashboard')
    expect(store.isPreviewOpenFor('http://localhost:5173/dashboard')).toBe(true)
    // toggle live page → 关（closeBrowserPreviewMatchingLiveUrl 语义）
    store.togglePreviewTab('http://localhost:5173/dashboard', undefined)
    expect(store.getPreviewStoreState().tabs).toHaveLength(0)
    // 重开 + 导航，再 toggle 打开时地址 → 也关（preview-row 按 source 判断语义）
    store.togglePreviewTab('http://localhost:5173/', undefined)
    tab = store.getPreviewStoreState().tabs[0]
    store.commitBrowserPage(tab.id, 'http://localhost:5173/dashboard')
    store.togglePreviewTab('http://localhost:5173/', undefined)
    expect(store.getPreviewStoreState().tabs).toHaveLength(0)
  })
})
