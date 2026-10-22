/**
 * local-preview 单测 — S0.2：joinPath 折叠 `..` 且不越根
 * （对齐 Hermes joinPath：同文件两种写法不得开出两个 tab）
 */
import { describe, expect, it } from 'vitest'
import { localPreviewTarget, normalizeOrLocalPreviewTarget } from './local-preview'

describe('localPreviewTarget（S0.2 joinPath 折叠）', () => {
  it('相对路径含 .. 折叠且与直连路径同结果', () => {
    const up = localPreviewTarget('x/../index.html', 'C:/proj')
    const direct = localPreviewTarget('index.html', 'C:/proj')
    expect(up?.url).toBe('C:/proj/index.html')
    expect(up?.url).toBe(direct?.url)
  })

  it('.. 越根不逃出盘符根', () => {
    const escaped = localPreviewTarget('../../x.html', 'C:/a/b')
    expect(escaped?.url).toBe('C:/x.html')
  })

  it('多余 ./ 段被吸收', () => {
    const dotted = localPreviewTarget('./sub/./y.html', 'C:/proj')
    expect(dotted?.url).toBe('C:/proj/sub/y.html')
  })

  it('UNC 根保留（\\\\srv\\share 不被 .. 越根）', () => {
    const escaped = localPreviewTarget('../../z.html', '//srv/share/deep')
    expect(escaped?.url).toBe('//srv/z.html')
  })

  it('Windows 盘符绝对路径不 join', () => {
    const abs = localPreviewTarget('D:\\other\\a.html', 'C:/proj')
    expect(abs?.url).toBe('D:\\other\\a.html')
  })

  it('http(s) 直接归 url target；file:// 解码为本地路径', () => {
    expect(localPreviewTarget('https://example.com')?.kind).toBe('url')
    const file = localPreviewTarget('file:///C:/w/report.html')
    expect(file?.kind).toBe('file')
    expect(file?.url).toBe('/C:/w/report.html')
  })

  it('normalizeOrLocalPreviewTarget = localPreviewTarget 直通', () => {
    expect(normalizeOrLocalPreviewTarget('a.html', 'C:/p')).toEqual(localPreviewTarget('a.html', 'C:/p'))
  })
})
