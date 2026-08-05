/**
 * rich-fence — 富围栏提升（mermaid / svg 懒加载渲染，共享模块）
 *
 * renderMarkdown 把 ```mermaid / ```svg 围栏输出为占位 pre（class="mermaid-block
 * |svg-block" + data-mermaid|data-svg 源码属性）。渲染完成后扫描容器内这些占位
 * 节点，异步提升为图形：
 * - mermaid → 懒加载 mermaid.js（securityLevel strict + 主题跟随）渲染 SVG
 * - svg → DOMPurify svg profile 硬清洗后内联
 * 失败均回退代码卡片（移除标记防重试）。
 *
 * 消息区（StreamBlocks）与文件预览 markdown 视图共用同一实现（对齐 Hermes
 * RichCodeBlock/embeds registry 的共享懒加载渲染器语义，不重复造轮子）。
 */

let mermaidReady = false
let lastMermaidTheme: 'dark' | 'default' | null = null
let dompurifyMod: { sanitize(html: string, opts?: Record<string, unknown>): string } | null = null

/**
 * 扫描并提升容器内的富围栏占位。返回 cleanup（组件卸载时置 cancelled，
 * 防止异步渲染完成后写入已卸载 DOM）。
 */
export function enhanceRichFences(container: HTMLElement): (() => void) | undefined {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-mermaid], [data-svg]'))
  if (nodes.length === 0) return undefined

  let cancelled = false

  void (async () => {
    try {
      const [{ default: mermaid }, dp] = await Promise.all([import('mermaid'), import('dompurify')])
      dompurifyMod = dp.default ?? dp
      // 主题跟随（对齐 Hermes useIsDark）：.dark class 由主题系统驱动
      const isDark = document.documentElement.classList.contains('dark')
      const theme: 'dark' | 'default' = isDark ? 'dark' : 'default'
      if (!mermaidReady || lastMermaidTheme !== theme) {
        // securityLevel: 'strict'：mermaid 清洗 label HTML 并丢弃 click handlers，
        // 渲染出的 SVG 可安全注入（对齐 Hermes mermaid-embed ensureInit）
        mermaid.initialize({ fontFamily: 'inherit', securityLevel: 'strict', startOnLoad: false, theme })
        mermaidReady = true
        lastMermaidTheme = theme
      }
      for (const node of nodes) {
        if (cancelled) break
        const isMermaid = node.hasAttribute('data-mermaid')
        const code = (node.getAttribute(isMermaid ? 'data-mermaid' : 'data-svg') ?? '').trim()
        if (!code) {
          node.removeAttribute('data-mermaid')
          node.removeAttribute('data-svg')
          continue
        }
        try {
          let svg: string
          if (isMermaid) {
            const id = `mmd-${Math.random().toString(36).slice(2, 10)}`
            const result = await mermaid.render(id, code)
            svg = result.svg
          } else {
            // svg profile 硬清洗（对齐 Hermes svg-embed）：剥 scripts/事件处理器/foreignObject
            svg = dompurifyMod!.sanitize(code, { USE_PROFILES: { svg: true, svgFilters: true } })
            if (!svg.trim()) {
              node.removeAttribute('data-svg')
              continue
            }
          }
          const wrapper = document.createElement('div')
          wrapper.className = isMermaid ? 'mermaid-svg' : 'svg-inline'
          wrapper.innerHTML = svg
          const card = node.closest('.code-block-wrapper')
          if (card && card.parentNode) card.replaceWith(wrapper)
          else node.replaceWith(wrapper)
        } catch {
          // 渲染失败（语法错误等）→ 回退代码卡片，移除标记防重试
          node.removeAttribute('data-mermaid')
          node.removeAttribute('data-svg')
        }
      }
    } catch {
      // 懒加载失败 → 全部回退代码卡片
      nodes.forEach((n) => {
        n.removeAttribute('data-mermaid')
        n.removeAttribute('data-svg')
      })
    }
  })()

  return () => {
    cancelled = true
  }
}
