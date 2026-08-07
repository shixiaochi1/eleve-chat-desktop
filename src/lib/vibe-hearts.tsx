/**
 * Floating hearts — 对齐 Hermes `components/chat/vibe-hearts.tsx` burstVibeHearts()。
 *
 * 由后端 `reaction` 事件触发（用户消息含 affection：ily / <3 / good bot / 心形 emoji，
 * 对齐 Hermes agent/reactions.py 词表）。纯 UI 彩蛋：永不触碰对话，永不致命。
 *
 * 零组件侵入：动态创建 fixed overlay（视口底部中央，composer 上方），爱心上浮/
 * 摇摆/淡出后自动清理。单视图与宫格通用，无需改动 composer 组件。
 */
const HEART_EMOJI = ['💗', '💖', '💕', '❤️', '🥰'] // 对齐 Hermes 爱意 emoji 词表
const HEART_COUNT = 10

let overlayEl: HTMLDivElement | null = null

function ensureOverlay(): HTMLDivElement {
  if (overlayEl && document.body.contains(overlayEl)) return overlayEl
  const el = document.createElement('div')
  el.className = 'vibe-hearts-overlay'
  document.body.appendChild(el)
  overlayEl = el
  return el
}

/** 播放一波爱心（TikTok 风格上浮），动画结束后自动清理。 */
export function burstVibeHearts(count: number = HEART_COUNT): void {
  const overlay = ensureOverlay()
  for (let i = 0; i < count; i++) {
    const heart = document.createElement('span')
    heart.className = 'vibe-heart'
    heart.textContent = HEART_EMOJI[i % HEART_EMOJI.length]
    // 横向位置：底部中央 ±160px 随机
    heart.style.left = `${(Math.random() - 0.5) * 320}px`
    heart.style.fontSize = `${14 + Math.random() * 14}px`
    // 摇摆幅度 + 时长随机，制造错落感
    heart.style.setProperty('--sway', `${10 + Math.random() * 14}px`)
    heart.style.animationDuration = `${1.2 + Math.random() * 0.9}s`
    overlay.appendChild(heart)
    heart.addEventListener('animationend', () => heart.remove())
  }
}
