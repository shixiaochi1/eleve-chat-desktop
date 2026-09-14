/**
 * 群聊消息区**渲染窗口**与**粘底**两个判据的唯一实现。
 *
 * 🔴 2026-09-15：这两条此前内联在 `BotsView.tsx`，且各有真实缺陷——
 *
 * ① **渲染窗口恒为尾部 200**（`events.slice(-200)`），而"加载更早消息"只把更早的
 *    事件并进 `events`：窗口从**尾部**算 ⇒ 加载到的历史**永远不渲染**（按钮点了
 *    没反应，只白涨内存与请求）。正确语义 = 用户**显式**要历史后，就渲染**全部
 *    已载入**（`events` 只装已拉取的量：首屏 200 + 每次点击 200 + 期间新到的事件），
 *    见 [`renderWindow`]。
 *
 * ② **自动滚底无"用户是否在底部"判定**，每个新事件都把正在上翻读历史的用户拽回
 *    底部。Hermes 在 #89835 修的正是这个（`group-chat-view.tsx:525-559` 原文）：
 *    *"Scroll the bottom sentinel into view on mount and whenever the log grows —
 *    but only when the user is already near the bottom, so reading history is
 *    never yanked away."* 阈值同款：`scrollHeight - scrollTop - clientHeight < 80`
 *    （`:543`）。
 *
 * 判据只允许一份：组件不得再内联 `slice(-N)` 或滚动阈值。
 */

/** 每页 / 初始渲染窗口的事件条数（后端 `bot.rooms.events` 的页大小同值 200）。 */
export const MESSAGE_WINDOW_PAGE = 200;

/** "已在底部"的容差（像素）——与 Hermes `group-chat-view.tsx:543` 同值。 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

/**
 * 取 `items` 的**最后** `size` 条（保持到达顺序）。
 *
 * `size <= 0` / 非有限 → 空数组（未知不能当"全都要"）。`size >= length` → 原数组
 * 的浅拷贝语义（`slice` 不产生越界）。
 */
export function messageWindow<T>(items: T[], size: number): T[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  return items.length <= size ? items.slice() : items.slice(items.length - size);
}

/**
 * 消息区实际渲染哪些事件：**默认**只渲染最新一页（长房间不无限增长 DOM）；
 * 用户点过"加载更早消息"（`expanded`）后渲染**全部已载入**的事件。
 *
 * 为何不是"窗口大小随加载增长"：窗口是从**尾部**算的下标窗口，若它固定为
 * `200 × (1+页数)`，则加载历史之后每来一条新事件都会把最老的那条挤出窗口——
 * 用户刚翻到的历史会自己消失。改成"展开即全部"，语义简单且与阅读行为一致。
 */
export function renderWindow<T>(items: T[], expanded: boolean, page = MESSAGE_WINDOW_PAGE): T[] {
  return expanded ? items.slice() : messageWindow(items, page);
}

/**
 * 滚动容器是否**已接近底部**（严格小于阈值——既距底部恰好 `threshold` 像素
 * 视为"已离开底部"，与 Hermes 的 `<` 一致）。
 *
 * 用途：新事件到达时只有本判据为真才自动滚到底，否则保持用户当前的阅读位置。
 */
export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}
