/**
 * ImageEditorModal v2 — 聊天区图片局部重绘编辑器（🔴 2026-08-22 重构修 BUG）
 *
 * 架构：壳的独立能力（与画布插件零耦合）——主窗口内全屏编辑，不弹新窗口。
 * 编辑完成 → 合成标注图（原图+红色标注）→ 作为附件发给 ELEVE 走 image_gen。
 *
 * v2 修复：
 * 1. 🔴 坐标对齐：canvas 像素尺寸 = img 实际显示尺寸（同 flex-center 定位），
 *    彻底消除 object-contain 留边导致的涂抹错位
 * 2. 🔴 撤销语义：快照在【操作前】入栈（undo 回到操作前），非操作后
 * 3. 多边形绘制中可退点（撤销按钮/Ctrl+Z）
 * 4. 蒙版预览（红↔白切换）
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type ToolMode = 'brush' | 'eraser' | 'rect' | 'polygon'

interface ImageEditorModalProps {
  src: string
  name?: string
  onConfirm: (annotatedDataUrl: string, name: string) => void
  onCancel: () => void
}

const BRUSH_MIN = 4
const BRUSH_MAX = 80

export function ImageEditorModal({ src, name, onConfirm, onCancel }: ImageEditorModalProps) {
  const [tool, setTool] = useState<ToolMode>('brush')
  const [brushSize, setBrushSize] = useState(20)
  const [featherSize, setFeatherSize] = useState(5)   // 🔴 v3：羽化（对齐画布 shadowBlur）
  const [maskOpacity, setMaskOpacity] = useState(0.35) // 🔴 v3：蒙版显示透明度（对齐画布默认 0.35，容器 opacity）
  const [showMask, setShowMask] = useState(false)     // 蒙版预览：红色满显（opacity 1）
  const [saving, setSaving] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  const drawingRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const rectStartRef = useRef<{ x: number; y: number } | null>(null)
  const polygonPtsRef = useRef<Array<{ x: number; y: number }>>([])
  const snapRef = useRef<HTMLImageElement | null>(null) // 框选/多边形起点快照
  const snapDataRef = useRef<string | null>(null)       // 快照 data URL（兜底）

  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])

  const ctx = () => maskCanvasRef.current?.getContext('2d') ?? null

  // 🔴 v3：蒙版绘制 = 实色红 1.0（对齐画布 InpaintNode brush：strokeStyle
  // rgba(255,50,50,1.0) + shadowBlur 羽化）；显示透明度由容器 opacity 控制）
  const MASK_RED = 'rgba(255,50,50,1)'

  // 🔴 v4：document 级 pointer 监听需读最新 tool/brushSize/feather（ref）
  const toolRef = useRef(tool); toolRef.current = tool
  const brushSizeRef = useRef(brushSize); brushSizeRef.current = brushSize
  const featherSizeRef = useRef(featherSize); featherSizeRef.current = featherSize

  // 坐标换算（clientX/Y → canvas 内像素；兼容 React 与原生 PointerEvent）
  const getPos = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = maskCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // 🔴 v2：初始化——canvas 像素尺寸 = img 实际显示尺寸（对齐坐标）
  useEffect(() => {
    const canvas = maskCanvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const onLoad = () => {
      const r = img.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      canvas.width = Math.round(r.width)
      canvas.height = Math.round(r.height)
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      ctx()?.clearRect(0, 0, canvas.width, canvas.height)
      undoStackRef.current = []
      redoStackRef.current = []
      pushUndo()
    }
    if (img.complete) onLoad()
    else img.addEventListener('load', onLoad)
    return () => img.removeEventListener('load', onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // 🔴 v2：撤销快照——入栈的是【当前状态】（操作前），undo 回到它
  const pushUndo = useCallback(() => {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    undoStackRef.current.push(canvas.toDataURL())
    if (undoStackRef.current.length > 60) undoStackRef.current.shift()
    redoStackRef.current = []
    setCanUndo(undoStackRef.current.length > 1)
    setCanRedo(false)
  }, [])

  const restoreImage = useCallback((canvas: HTMLCanvasElement, dataUrl: string, cb?: () => void) => {
    const c = canvas.getContext('2d')
    if (!c) return
    const img = new Image()
    img.onload = () => {
      c.clearRect(0, 0, canvas.width, canvas.height)
      c.drawImage(img, 0, 0)
      cb?.()
    }
    img.src = dataUrl
  }, [])

  const undo = useCallback(() => {
    // 🔴 多边形绘制中（未闭合）→ 退一个顶点
    if (tool === 'polygon' && polygonPtsRef.current.length > 0) {
      polygonPtsRef.current.pop()
      drawPolygonPreview()
      return
    }
    const stack = undoStackRef.current
    if (stack.length < 2) return
    const canvas = maskCanvasRef.current
    if (!canvas) return
    redoStackRef.current.push(stack.pop()!)
    const prev = stack[stack.length - 1]
    restoreImage(canvas, prev)
    setCanUndo(stack.length > 1)
    setCanRedo(redoStackRef.current.length > 0)
  }, [tool, restoreImage])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const canvas = maskCanvasRef.current
    if (!canvas) return
    const next = stack.pop()!
    undoStackRef.current.push(next)
    restoreImage(canvas, next)
    setCanUndo(undoStackRef.current.length > 1)
    setCanRedo(stack.length > 0)
  }, [restoreImage])

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current
    const c = ctx()
    if (!canvas || !c) return
    pushUndo() // 🔴 操作前快照
    c.clearRect(0, 0, canvas.width, canvas.height)
    polygonPtsRef.current = []
    snapRef.current = null
    snapDataRef.current = null
  }, [pushUndo])

  // Esc / Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, undo, redo])

  // 🔴 v3：画笔/橡皮自定义光标——圆圈直径 = 实际绘制直径（r=brushSize/2）
  useEffect(() => {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    if (tool === 'rect' || tool === 'polygon') {
      canvas.style.cursor = 'crosshair'
      return
    }
    const r = brushSize / 2 // 实际绘制半径
    const s = Math.max(r * 2 + 8, 20)
    const color = tool === 'eraser' ? '#3b82f6' : '#ff3232'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="2"/></svg>`
    canvas.style.cursor = `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${s / 2} ${s / 2}, crosshair`
  }, [tool, brushSize])

  const snapshotToImg = (): HTMLImageElement | null => {
    const canvas = maskCanvasRef.current
    if (!canvas) return null
    snapDataRef.current = canvas.toDataURL()
    const img = new Image()
    img.src = snapDataRef.current
    return img
  }

  // 多边形预览：快照恢复 + 顶点/连线/半透明
  const drawPolygonPreview = useCallback(() => {
    const canvas = maskCanvasRef.current
    const c = ctx()
    if (!canvas || !c || !snapRef.current) return
    const pts = polygonPtsRef.current
    c.clearRect(0, 0, canvas.width, canvas.height)
    c.drawImage(snapRef.current, 0, 0)
    if (pts.length === 0) return
    c.beginPath()
    c.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y)
    c.lineJoin = 'round'
    c.strokeStyle = 'rgba(255,50,50,0.9)'
    c.lineWidth = 2
    c.stroke()
    if (pts.length > 2) {
      c.closePath()
      c.fillStyle = 'rgba(255,50,50,0.25)'
      c.fill()
      c.stroke()
    }
    pts.forEach((p, i) => {
      if (i === 0) {
        const canClose = pts.length >= 3
        c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2)
        c.fillStyle = canClose ? 'rgba(34,197,94,0.9)' : MASK_RED
        c.fill()
        c.beginPath(); c.arc(p.x, p.y, canClose ? 12 : 9, 0, Math.PI * 2)
        c.strokeStyle = canClose ? 'rgba(34,197,94,0.9)' : 'rgba(255,50,50,0.6)'
        c.lineWidth = 2
        c.stroke()
      } else {
        c.beginPath(); c.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
        c.fillStyle = MASK_RED
        c.fill()
      }
    })
  }, [])

  const closePolygon = useCallback(() => {
    const canvas = maskCanvasRef.current
    const c = ctx()
    const pts = polygonPtsRef.current
    if (!canvas || !c) return
    if (pts.length >= 3) {
      c.beginPath()
      c.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y)
      c.closePath()
      c.shadowBlur = featherSize // 🔴 v3：羽化软边
      c.shadowColor = MASK_RED
      c.fillStyle = MASK_RED // 实色红（对齐画布），显示透明度走容器 opacity
      c.fill()
      c.shadowBlur = 0
      c.strokeStyle = 'rgba(255,50,50,0.8)'
      c.lineWidth = 2
      c.stroke()
    }
    polygonPtsRef.current = []
    snapRef.current = null
    snapDataRef.current = null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = maskCanvasRef.current
    const c = ctx()
    if (!canvas || !c) return
    e.stopPropagation()
    e.preventDefault()
    const pos = getPos(e)

    if (tool === 'brush' || tool === 'eraser') {
      if (!drawingRef.current) pushUndo() // 🔴 操作前快照（每笔起点）
      drawingRef.current = true
      lastPosRef.current = pos
      c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.lineWidth = brushSize
      // 🔴 v3：羽化软边（shadowBlur）——对齐画布 featherSize
      c.shadowBlur = featherSize
      c.shadowColor = MASK_RED
      c.strokeStyle = MASK_RED
      c.beginPath()
      c.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2)
      c.fillStyle = MASK_RED
      c.fill()
    } else if (tool === 'rect') {
      if (!rectStartRef.current) pushUndo() // 🔴 操作前快照
      drawingRef.current = true
      rectStartRef.current = pos
      lastPosRef.current = pos
      snapRef.current = snapshotToImg()
    } else if (tool === 'polygon') {
      const pts = polygonPtsRef.current
      if (pts.length === 0) {
        pushUndo() // 🔴 多边形开始前快照
        snapRef.current = snapshotToImg()
      }
      if (pts.length >= 3) {
        const first = pts[0]
        if (Math.hypot(pos.x - first.x, pos.y - first.y) < 20) { closePolygon(); return }
      }
      pts.push(pos)
      drawPolygonPreview()
    }
  }, [tool, brushSize, pushUndo, closePolygon, drawPolygonPreview])

  // 🔴 v4：对齐画布——pointermove/up 用 document 级监听（画布 InpaintNode L777
  // document.addEventListener('pointermove')）。元素级 onPointerMove 在快速涂抹
  // 时事件丢失 → 线段断裂（点划线）。常驻注册，drawingRef/toolRef 门控。
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const canvas = maskCanvasRef.current
      const c = ctx()
      if (!canvas || !c || !drawingRef.current) return
      const pos = getPos(e)
      const t = toolRef.current

      if (t === 'brush' || t === 'eraser') {
        c.globalCompositeOperation = t === 'eraser' ? 'destination-out' : 'source-over'
        c.lineCap = 'round'
        c.lineJoin = 'round'
        c.lineWidth = brushSizeRef.current
        c.strokeStyle = MASK_RED
        c.shadowBlur = featherSizeRef.current
        c.shadowColor = MASK_RED
        const last = lastPosRef.current
        if (last) {
          c.beginPath()
          c.moveTo(last.x, last.y)
          c.lineTo(pos.x, pos.y)
          c.stroke()
        }
        lastPosRef.current = pos
      } else if (t === 'rect' && rectStartRef.current && snapRef.current) {
        lastPosRef.current = pos
        c.clearRect(0, 0, canvas.width, canvas.height)
        c.drawImage(snapRef.current, 0, 0)
        const s = rectStartRef.current
        const x = Math.min(s.x, pos.x), y = Math.min(s.y, pos.y)
        const w = Math.abs(pos.x - s.x), h = Math.abs(pos.y - s.y)
        c.fillStyle = 'rgba(255,50,50,0.3)'
        c.fillRect(x, y, w, h)
        c.strokeStyle = 'rgba(255,50,50,0.8)'
        c.lineWidth = 2
        c.strokeRect(x, y, w, h)
      }
    }
    const handleUp = (e: PointerEvent) => {
      if (!drawingRef.current) return
      const canvas = maskCanvasRef.current
      const c = ctx()
      if (canvas && c) {
        if (toolRef.current === 'rect' && rectStartRef.current && snapRef.current) {
          const s = rectStartRef.current
          const end = lastPosRef.current
          if (end) {
            c.clearRect(0, 0, canvas.width, canvas.height)
            c.drawImage(snapRef.current, 0, 0)
            const x = Math.min(s.x, end.x), y = Math.min(s.y, end.y)
            const w = Math.abs(end.x - s.x), h = Math.abs(end.y - s.y)
            c.shadowBlur = featherSizeRef.current // 羽化软边
            c.shadowColor = MASK_RED
            c.fillStyle = MASK_RED // 实色红（对齐画布）
            c.fillRect(x, y, w, h)
            c.shadowBlur = 0
          }
          rectStartRef.current = null
          snapRef.current = null
          snapDataRef.current = null
        }
      }
      drawingRef.current = false
      lastPosRef.current = null
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 🔴 v3：合成标注图——完全对齐画布 composeMaskOverlay 语义：
  // 蒙版红色区 → 白化 → 红层（255,60,60,255）→ 原图（自然尺寸）+ 红层 55% 叠加 → PNG
  const handleConfirm = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const img = imgRef.current
      const maskCanvas = maskCanvasRef.current
      if (!img || !maskCanvas) return
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return

      // 1. 蒙版 canvas（显示尺寸）缩放到原图自然尺寸 → 白化（涂=白，非涂=透明）
      const maskLayer = document.createElement('canvas')
      maskLayer.width = w
      maskLayer.height = h
      const mctx = maskLayer.getContext('2d')!
      mctx.drawImage(maskCanvas, 0, 0, w, h)
      const maskPixels = mctx.getImageData(0, 0, w, h)
      const md = maskPixels.data
      for (let i = 0; i < md.length; i += 4) {
        const r = md[i], g = md[i + 1], b = md[i + 2], a = md[i + 3]
        if (a > 0 && r > 180 && g < 120 && b < 120) {
          // 红色（涂抹区域）→ 白
          md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = 255
        } else {
          md[i + 3] = 0 // 其它 → 透明
        }
      }
      mctx.putImageData(maskPixels, 0, 0)

      // 2. 红层：白区 → 红（对齐画布 255,60,60,255）
      const redLayer = document.createElement('canvas')
      redLayer.width = w
      redLayer.height = h
      const rctx = redLayer.getContext('2d')!
      rctx.drawImage(maskLayer, 0, 0)
      const rp = rctx.getImageData(0, 0, w, h)
      const rd = rp.data
      for (let i = 0; i < rd.length; i += 4) {
        if (rd[i] === 255 && rd[i + 1] === 255 && rd[i + 2] === 255 && rd[i + 3] === 255) {
          rd[i] = 255; rd[i + 1] = 60; rd[i + 2] = 60; rd[i + 3] = 255
        }
      }
      rctx.putImageData(rp, 0, 0)

      // 3. 原图 + 红层 55% 叠加（对齐画布 globalAlpha 0.55）→ 等比缩放 maxDim=1024 → PNG
      // 🔴 v4 修复：不压缩会输出原图自然尺寸 PNG（4K 图 10-20MB）→ WS attach 传输失败
      // → ELEVE 收不到图（对齐画布 composeMaskOverlay 的 compressImage maxDim=1024）
      const maxDim = 1024
      const scale = Math.min(1, maxDim / Math.max(w, h))
      const outW = Math.round(w * scale)
      const outH = Math.round(h * scale)
      const out = document.createElement('canvas')
      out.width = outW
      out.height = outH
      const octx = out.getContext('2d')!
      octx.drawImage(img, 0, 0, outW, outH)
      octx.globalAlpha = 0.55
      octx.drawImage(redLayer, 0, 0, outW, outH)
      octx.globalAlpha = 1
      const dataUrl = out.toDataURL('image/png') // PNG 无损（对齐画布防红边晕开）
      const base = (name || 'image').replace(/\.[^.]+$/, '')
      onConfirm(dataUrl, `${base}-标注.png`)
    } catch (err) {
      console.error('[ImageEditor] 合成失败:', err)
    } finally {
      setSaving(false)
    }
  }, [name, onConfirm, saving])

  const btn = (t: ToolMode, label: string, title: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${active ? 'bg-blue-500 text-white' : 'bg-white/10 text-white hover:bg-white/25'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true">
      {/* 标题行 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/40">
        <span className="text-xs text-white/70">局部重绘编辑</span>
        <button onClick={onCancel} title="关闭 (Esc)" className="grid size-7 place-items-center rounded-md bg-white/10 text-white hover:bg-white/25">✕</button>
      </div>

      {/* 图片区 */}
      <div
        ref={wrapRef}
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onDoubleClick={() => { if (tool === 'polygon') closePolygon() }}
      >
        <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
          <img
            ref={imgRef}
            src={src}
            alt={name ?? '编辑图片'}
            className="block max-w-full max-h-full select-none pointer-events-none"
            draggable={false}
          />
          <canvas
            ref={maskCanvasRef}
            className="absolute inset-0 select-none"
            style={{
              // 🔴 v3：显示透明度 = 容器 opacity（对齐画布：maskOpacity 默认 0.35；
              // 蒙版预览 = opacity 1 红色满显，非白色 filter）
              opacity: showMask ? 1 : maskOpacity,
            }}
            onPointerDown={onPointerDown}
            onDoubleClick={() => { if (tool === 'polygon') closePolygon() }}
          />
        </div>
      </div>

      {/* 🔴 v2：工具条在图片下方（对齐画布重绘节点布局） */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-white/10 bg-black/40 flex-wrap">
        {btn('brush', '🖌️ 画笔', '涂抹标记要修改的区域', tool === 'brush', () => setTool('brush'))}
        {btn('eraser', '🧽 橡皮', '擦除涂抹', tool === 'eraser', () => setTool('eraser'))}
        {btn('rect', '⬜ 矩形', '拖拽框选矩形区域', tool === 'rect', () => setTool('rect'))}
        {btn('polygon', '⬠ 多边形', '点击加点，双击或点回起点闭合', tool === 'polygon', () => setTool('polygon'))}
        <div className="w-px h-5 bg-white/15 mx-1" />
        <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" className="rounded-md px-2.5 py-1.5 text-xs bg-white/10 text-white hover:bg-white/25 disabled:opacity-30">↩ 撤销</button>
        <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)" className="rounded-md px-2.5 py-1.5 text-xs bg-white/10 text-white hover:bg-white/25 disabled:opacity-30">↪ 重做</button>
        <button onClick={clearMask} title="清除所有涂抹" className="rounded-md px-2.5 py-1.5 text-xs bg-white/10 text-white hover:bg-white/25">🗑 清除</button>
        <button onClick={() => setShowMask(v => !v)} title="蒙版预览（红色标注/白色蒙版切换）" className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${showMask ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white hover:bg-white/25'}`}>
          👁 蒙版{showMask ? '：白' : '：红'}
        </button>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5" title="画笔/橡皮大小">
            <span className="text-[10px] text-white/60">笔刷</span>
            <input type="range" min={BRUSH_MIN} max={BRUSH_MAX} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-20 accent-blue-500" />
            <span className="text-[10px] text-white/60 w-6 text-right">{brushSize}</span>
          </div>
          {/* 🔴 v3：羽化（蒙版边缘柔和）——对齐画布 featherSize */}
          <div className="flex items-center gap-1.5" title="羽化：蒙版边缘柔和程度">
            <span className="text-[10px] text-white/60">羽化</span>
            <input type="range" min={0} max={30} value={featherSize} onChange={(e) => setFeatherSize(Number(e.target.value))} className="w-16 accent-blue-500" />
            <span className="text-[10px] text-white/60 w-5 text-right">{featherSize}</span>
          </div>
          {/* 🔴 v3：蒙版不透明度（显示浓淡）——对齐画布 maskOpacity */}
          <div className="flex items-center gap-1.5" title="蒙版显示透明度（容器 opacity，对齐画布）">
            <span className="text-[10px] text-white/60">蒙版</span>
            <input type="range" min={0.2} max={0.9} step={0.05} value={maskOpacity} onChange={(e) => setMaskOpacity(Number(e.target.value))} className="w-16 accent-blue-500" />
            <span className="text-[10px] text-white/60 w-8 text-right">{Math.round(maskOpacity * 100)}%</span>
          </div>
        </div>
      </div>

      {/* 底部说明 + 操作 */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-white/10 bg-black/40">
        <span className="text-[11px] text-white/50">
          {tool === 'brush' ? '在图片上涂抹红色区域 = 要局部修改的位置' :
           tool === 'eraser' ? '擦除误涂的区域' :
           tool === 'rect' ? '拖拽框选矩形区域' :
           '点击加点（≥3 点），双击或点回绿色起点闭合'}
          ，确认后发给 ELEVE 按红色区域局部重绘
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={onCancel} className="rounded-lg px-5 py-2 text-sm bg-white/10 text-white hover:bg-white/20">取消</button>
          <button onClick={handleConfirm} disabled={saving} className="rounded-lg px-6 py-2 text-sm font-medium bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50">
            {saving ? '合成中...' : '✓ 确认，用于局部重绘'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageEditorModal
