/**
 * useSortableList — 通用列表拖拽排序（指针跟手 + FLIP 让位动画）
 *
 * 设计（2026-08-20，Agent 卡片 / 项目卡片共用，参照 GridModeView 已验证的
 * 指针拖拽模式做列表版）：
 * - 容器 position:relative；每个 item 绝对定位 top:0 left:0（宽度 100%），
 *   槽位 = index * (itemHeight + gap)——命令式 setSlot 写 transform + CSS
 *   transition，零 React 渲染（拖拽期间只更新投影顺序，其余卡平滑滑过）
 * - 动态高度（不传 itemHeight）：每项挂 ResizeObserver 实测高度；实测变化时
 *   hook 内部立即重结算全部槽位（带让位动画，被拖项跳过）并回调 onHeightsChange
 *   ——调用方只需据此刷新容器占位高等派生布局（如展开/收起预览后的对齐）
 * - 被拖项直接写 DOM transform 跟手（scale 1.03 提起 + 阴影），松手弹性归位
 * - 换位只更新投影（projectedOrder）；松手 onReorder 提交 → 调用方持久化
 * - 边缘自动滚动（多行/长列表拖到不可见区域）
 *
 * 用法：
 *   const sortable = useSortableList({ ids, onReorder, itemHeight, gap });
 *   <div ref={sortable.containerRef} style={{position:'relative', height: contentH}} onPointerDown={sortable.onPointerDown}>
 *     {ids.map((id, i) => (
 *       <div key={id} ref={el => sortable.registerItem(id, el)}
 *            data-sortable-id={id} className="absolute top-0 left-0"
 *            style={{width:'100%', height:itemHeight}}>
 *         {children}   // 卡片内把手区加 data-drag-handle
 *       </div>
 *     ))}
 *   </div>
 */
import { useCallback, useEffect, useRef } from 'react'

interface SortableListOptions {
  /** 当前顺序（id 数组） */
  ids: string[]
  /** 松手提交新顺序（调用方负责持久化） */
  onReorder: (ids: string[]) => void
  /** 固定项高（px）——等高卡片场景（如 ProfilePanel）；缺省 = 动态测量各项实际高度 */
  itemHeight?: number
  /** 项间距（px） */
  gap?: number
  /** 顶部内边距（px，槽位偏移基准） */
  padTop?: number
  /** 拖拽提起缩放 */
  liftScale?: number
  /** 换位过渡缓动 */
  ease?: string
  /** 拖拽状态回调（视觉：被拖项/悬停目标高亮） */
  onDragStateChange?: (state: { activeId: string | null; overId: string | null }) => void
  /** 项实测高度变化回调（动态高度模式）——槽位重结算由 hook 内部完成，
   *  此回调供调用方刷新容器占位高等派生布局（contentHeight 读内部缓存，React 不可见） */
  onHeightsChange?: () => void
}

interface DragState {
  id: string
  el: HTMLElement
  downX: number
  downY: number
  grabX: number
  grabY: number
  active: boolean
}

const DEFAULT_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
const AUTO_SCROLL_EDGE = 48
const AUTO_SCROLL_STEP = 12

export function useSortableList({
  ids,
  onReorder,
  itemHeight,
  gap = 6,
  padTop = 0,
  liftScale = 1.03,
  ease = DEFAULT_EASE,
  onDragStateChange,
  onHeightsChange,
}: SortableListOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const heightsRef = useRef(new Map<string, number>())
  const roRefs = useRef(new Map<string, ResizeObserver>())
  const dragRef = useRef<DragState | null>(null)
  const projectedRef = useRef<string[]>([])
  const idsRef = useRef(ids)
  idsRef.current = ids
  const itemHeightRef = useRef(itemHeight)
  itemHeightRef.current = itemHeight
  const onHeightsChangeRef = useRef(onHeightsChange)
  onHeightsChangeRef.current = onHeightsChange

  /** 单项目前高度（固定 itemHeight 或测量缓存） */
  const heightOf = useCallback((id: string): number => {
    const fixed = itemHeightRef.current
    if (fixed) return fixed
    return heightsRef.current.get(id) ?? 68
  }, [])

  /** 第 index 项的槽位 top（前面各项高度累积 + 间距） */
  const slotTop = useCallback((index: number): number => {
    const list = idsRef.current
    let top = padTop
    for (let i = 0; i < index && i < list.length; i++) top += heightOf(list[i]) + gap
    return top
  }, [padTop, gap, heightOf])

  const setSlot = useCallback((id: string, index: number, animate: boolean) => {
    const el = itemRefs.current.get(id)
    if (!el) return
    el.style.transition = animate ? `transform ${ease} 0.28s` : 'none'
    el.style.transform = `translateY(${slotTop(index)}px)`
  }, [slotTop, ease])

  /** 归位所有项（被拖项跳过） */
  const settleAll = useCallback((skipId?: string, animate = true) => {
    idsRef.current.forEach((id, idx) => {
      if (id !== skipId) setSlot(id, idx, animate)
    })
  }, [setSlot])

  const registerItem = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      itemRefs.current.set(id, el)
      // 动态高度：注册时测量 + ResizeObserver 跟随（预览展开/收起）。
      // 🔴 2026-09-05 展开/收起对齐修复：实测高度变化必须当场重结算槽位——
      // 槽位 top 是前面各项高度的累积，任一项变高/变矮而后续项 transform 不动，
      // 展开会压住下方卡片、收起会留空洞。transform 不影响 content-box，
      // 重结算不会回环触发 RO；被拖项跳过（跟手中不归位）。
      const measure = (): boolean => {
        const h = el.offsetHeight
        if (h <= 0) return false
        const prev = heightsRef.current.get(id)
        heightsRef.current.set(id, h)
        return prev !== h
      }
      measure()
      if (!itemHeightRef.current) {
        roRefs.current.get(id)?.disconnect()
        const ro = new ResizeObserver(() => {
          if (!measure()) return
          settleAll(dragRef.current?.id, true)
          onHeightsChangeRef.current?.()
        })
        ro.observe(el)
        roRefs.current.set(id, ro)
      }
    } else {
      itemRefs.current.delete(id)
      heightsRef.current.delete(id)
      // RAII：注销即断开观察（ref 回调每次渲染 null→el 重挂，防 RO 堆积）
      roRefs.current.get(id)?.disconnect()
      roRefs.current.delete(id)
    }
  }, [settleAll])

  /** 内容总高（容器 height） */
  const contentHeight = useCallback((): number => {
    const list = idsRef.current
    let total = padTop
    for (let i = 0; i < list.length; i++) total += heightOf(list[i]) + gap
    return total - gap
  }, [padTop, gap, heightOf])

  const onWindowMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const container = containerRef.current
    if (!container) return

    // 4px 阈值：区分点击与拖拽（点击卡片 = 聚焦，不触发换位）
    if (!d.active) {
      if (Math.abs(e.clientX - d.downX) < 4 && Math.abs(e.clientY - d.downY) < 4) return
      d.active = true
      d.el.style.zIndex = '30'
      d.el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)'
      d.el.style.transition = 'none'
      onDragStateChange?.({ activeId: d.id, overId: null })
    }

    const cRect = container.getBoundingClientRect()
    // 边缘自动滚动
    const cursorViewY = e.clientY - cRect.top
    if (cursorViewY < AUTO_SCROLL_EDGE) container.scrollTop -= AUTO_SCROLL_STEP
    else if (cursorViewY > cRect.height - AUTO_SCROLL_EDGE) container.scrollTop += AUTO_SCROLL_STEP

    // 被拖项跟手（唯一真值源，永不漂移）
    const contentY = e.clientY - cRect.top + container.scrollTop
    const ty = contentY - d.grabY
    d.el.style.transform = `translateY(${ty}px) scale(${liftScale})`

    // 换位检测：光标落在哪个槽位（累积高度，支持动态项高）
    const proj = projectedRef.current
    const relY = contentY - padTop
    let acc = 0
    let to = proj.length - 1
    for (let i = 0; i < proj.length; i++) {
      const h = heightOf(proj[i])
      if (relY < acc + h + gap / 2) { to = i; break }
      acc += h + gap
    }
    const from = proj.indexOf(d.id)
    if (to === from || to < 0 || proj[to] === d.id) return

    // 只更新投影（不触发 React 渲染），其余项平滑滑到新槽位
    ;[proj[from], proj[to]] = [proj[to], proj[from]]
    proj.forEach((nm, idx) => {
      if (nm !== d.id) setSlot(nm, idx, true)
    })
    onDragStateChange?.({ activeId: d.id, overId: proj[to] })
  }, [padTop, gap, heightOf, setSlot, onDragStateChange])

  const onWindowUp = useCallback(() => {
    const d = dragRef.current
    if (d && d.active) {
      const proj = [...projectedRef.current]
      // 提交投影 → 调用方持久化 + React 重排（异步）
      onReorder(proj)
      const el = d.el
      el.style.zIndex = ''
      el.style.boxShadow = ''
      // 🔴 2026-08-20 修复（从上往下拖两张卡叠加根因）：被拖项归位到
      // **投影新槽位**，不再清空 transform——清空会让它回落 absolute top-0
      // 与让位卡叠加（从下往上拖碰巧正确，从上往下拖必现）。
      // 等高槽位 slotTop(projIndex) 精确；动态高度（项目行）由调用方
      // settleAll（依赖顺序变化重跑）最终兜底纠正。
      const newIdx = proj.indexOf(d.id)
      requestAnimationFrame(() => {
        el.style.transition = `transform ${ease} 0.3s`
        setSlot(d.id, newIdx, true)
      })
    }
    dragRef.current = null
    onDragStateChange?.({ activeId: null, overId: null })
    window.removeEventListener('pointermove', onWindowMove)
    window.removeEventListener('pointerup', onWindowUp)
    window.removeEventListener('pointercancel', onWindowUp)
  }, [onWindowMove, onReorder, ease, setSlot, onDragStateChange])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // 🔴 2026-08-20 对齐 Hermes overview-row 行级 listeners：整行可拖，仅排除
    // 交互元素（按钮/输入/链接/行操作区/专用把手）。此前依赖 data-drag-handle
    // 包裹层——项目卡片 item 无固定高度时 handle（h-full）可能塌陷为 0，
    // closest 永远找不到 → 完全不能拖（AGENT 区 item 有固定 height 所以正常）。
    if (target.closest('button, input, a, [data-reorder-handle], [data-row-actions]')) return
    const item = target.closest('[data-sortable-id]') as HTMLElement | null
    if (!item) return
    const id = item.dataset.sortableId
    if (!id || !idsRef.current.includes(id)) return

    // 🔴 2026-08-20 点击失灵修复：**不用 setPointerCapture**——捕获会把
    // pointerup 的 target 拉到 handle（外层包裹 div），click 事件的 target
    // 变为"按下/抬起元素最近共同祖先"= handle，只向祖先冒泡 → handle 内部
    // 卡片（ProfileCard onClick=onSelect）收不到 click → 点击切换失灵。
    // 拖出元素/窗口的移动与松手已由 window 级监听覆盖（onWindowMove/
    // onWindowUp/onWindowCancel），capture 纯多余。

    const rect = item.getBoundingClientRect()
    dragRef.current = {
      id,
      el: item,
      downX: e.clientX,
      downY: e.clientY,
      grabX: e.clientY - rect.top,
      grabY: e.clientY - rect.top,
      active: false,
    }
    projectedRef.current = [...idsRef.current]

    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
  }, [onWindowMove, onWindowUp])

  // 卸载清理残留监听
  useCleanup(onWindowMove, onWindowUp)

  return {
    containerRef,
    registerItem,
    onPointerDown,
    /** 内容总高（函数：动态高度需实时计算；固定高场景也可调用） */
    contentHeight,
    /** 槽位 top（供 item 绝对定位容器对齐） */
    slotTop,
    /** 归位（ids/尺寸变化时调用，被拖项跳过） */
    settleAll,
  }
}

function useCleanup(...cleanups: Array<(..._args: any[]) => void>) {
  const ref = useRef(cleanups)
  ref.current = cleanups
  useUnmount(() => {
    ref.current.forEach((fn) => fn())
  })
}

function useUnmount(fn: () => void) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => () => fnRef.current(), [])
}
