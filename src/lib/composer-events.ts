/**
 * Composer 外部插入总线 — 移植 Hermes focus.ts 的 window CustomEvent 模式
 *
 * 只移植 requestComposerInsert / onComposerInsertRequest 最小集：
 * - ELEVE 是单 composer（InputArea），无 Hermes 的 main/edit/tile target 路由，
 *   故省略 target/focus/submit/refs 等不适用能力（对齐不发明轮子原则：需要什么拿什么）
 * - dispatch 用 macrotask（setTimeout 0）延后，同步 click/keydown handler 先完成，
 *   不抢 InputArea 的焦点（对齐 Hermes 同款设计理由）
 *
 * 消费方：InputArea（订阅 → 复用自身 insertTextAtCursor，零重复逻辑）
 * 生产方：PreviewConsolePanel 发送按钮
 */
const INSERT_EVENT = 'eleve:composer-insert'

/** 向 composer 光标处插入文本（trim 后为空则忽略，对齐 Hermes requestComposerInsert） */
export function requestComposerInsert(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<string>(INSERT_EVENT, { detail: trimmed }))
  }, 0)
}

/** 订阅插入请求；返回取消订阅函数（组件卸载时调用） */
export function onComposerInsertRequest(handler: (text: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(INSERT_EVENT, listener)
  return () => window.removeEventListener(INSERT_EVENT, listener)
}
