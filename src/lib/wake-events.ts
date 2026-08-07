/**
 * Wake-word 前端模块 — 对齐 Hermes `lib/wake-sound.ts` + `wake-indicator.ts` 最小集。
 *
 * 后端 `wake.detected` 事件（常开监听命中唤醒词）→ 前端：
 *   1. playWakeSound() — WebAudio 合成上升双音（G5→C6，"listening" 提示，
 *      无需音频资产；对齐 Hermes wake-sound.ts）
 *   2. dispatchWakeDetected() — window CustomEvent 总线（对齐 ELEVE
 *      composer-events.ts 移植的 Hermes focus.ts 模式），App 层订阅后
 *      开新会话 + 启动语音
 *
 * 纯 UI 信号：永不触碰对话，永不致命。
 */
const WAKE_EVENT = 'eleve:wake-detected'

export interface WakeDetectedDetail {
  phrase: string
  startNewSession: boolean
}

// ── 唤醒提示音（WebAudio 合成，对齐 Hermes wake-sound.ts）──
let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => undefined)
    }
    return audioCtx
  } catch {
    return null
  }
}

/** 单音：线性 attack + 指数衰减（对齐 Hermes ding()） */
function ding(ac: AudioContext, master: GainNode, t0: number, freq: number, dur: number, gain: number): void {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  const end = t0 + dur
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.connect(env)
  env.connect(master)
  osc.start(t0)
  osc.stop(end + 0.02)
}

/** 播放唤醒提示音（best-effort，永不抛错进事件 handler） */
export function playWakeSound(): void {
  const ac = getAudioCtx()
  if (!ac) return
  try {
    const master = ac.createGain()
    master.gain.setValueAtTime(0.5, ac.currentTime)
    master.connect(ac.destination)
    const t0 = ac.currentTime + 0.01
    // 上升纯四度：G5 → C6（对齐 Hermes）
    ding(ac, master, t0, 783.99, 0.12, 0.06)
    ding(ac, master, t0 + 0.1, 1046.5, 0.28, 0.07)
  } catch {
    // WebAudio 上下文死亡等异常：提示音丢失不能破坏唤醒处理
  }
}

// ── 唤醒事件总线（对齐 composer-events.ts 的 CustomEvent 模式）──
/** 广播唤醒命中（handleGlobalEvent 消费 wake.detected 后调用） */
export function dispatchWakeDetected(detail: WakeDetectedDetail): void {
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<WakeDetectedDetail>(WAKE_EVENT, { detail }))
  }, 0)
}

/** 订阅唤醒命中（App 层开新会话 + 语音）；返回取消订阅函数 */
export function onWakeDetected(handler: (detail: WakeDetectedDetail) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WakeDetectedDetail>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(WAKE_EVENT, listener)
  return () => window.removeEventListener(WAKE_EVENT, listener)
}
