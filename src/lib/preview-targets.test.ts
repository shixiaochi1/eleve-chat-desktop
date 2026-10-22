/**
 * preview-targets 单测 — S0.1：previewName Windows 绝对路径守卫
 * （对齐 Hermes isWindowsAbsolutePath：`new URL('C:\\…')` 会把盘符读成伪 scheme）
 */
import { describe, expect, it } from 'vitest'
import { previewDisplayLabel, previewName } from './preview-targets'

describe('previewName（S0.1 Windows 路径守卫）', () => {
  it('Windows 绝对路径取末段文件名而非整条路径', () => {
    expect(previewName('C:\\a\\b\\index.html')).toBe('index.html')
    expect(previewName('C:/a/b/index.html')).toBe('index.html')
  })

  it('file:// URL 解码后取末段', () => {
    expect(previewName('file:///C:/a/b%20c/report.html')).toBe('report.html')
  })

  it('http URL 取路径末段，无路径取 host', () => {
    expect(previewName('https://example.com/x/y.html')).toBe('y.html')
    expect(previewName('https://example.com')).toBe('example.com')
  })

  it('裸串按分隔符取末段', () => {
    expect(previewName('just-a-name')).toBe('just-a-name')
  })

  it('previewDisplayLabel 对 Windows 路径正常转义', () => {
    expect(previewDisplayLabel('C:\\a\\b.html')).toContain('b.html')
  })
})
