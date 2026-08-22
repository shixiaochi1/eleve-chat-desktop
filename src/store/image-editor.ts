/**
 * image-editor store — 主窗口图片局部重绘编辑器的全局入口（🔴 2026-08-22）
 *
 * 壳独立能力（与画布插件零耦合）。任一图片（输入区附件 / 消息区图片）都可
 * 经 openImageEditor 打开主窗口内嵌编辑器。Context 实现（无第三方依赖，
 * 穿透多层组件树，避免 prop 透传）。
 *
 * originalId：输入区附件编辑时传（确认后替换原附件）；消息区图片不传（新增）。
 * 编辑都在标注图副本上进行，不影响原图。
 */
import { createContext, useContext } from 'react'

export interface ImageEditorTarget {
  src: string
  name?: string
  /** 输入区附件 id：确认后替换原附件 */
  originalId?: string
}

export interface ImageEditorApi {
  target: ImageEditorTarget | null
  openImageEditor: (src: string, name?: string, originalId?: string) => void
  closeImageEditor: () => void
}

export const ImageEditorContext = createContext<ImageEditorApi>({
  target: null,
  openImageEditor: () => {},
  closeImageEditor: () => {},
})

/** 任意组件打开主窗口图片编辑器（MessageRow 等无需 prop 透传） */
export const useImageEditor = () => useContext(ImageEditorContext)
