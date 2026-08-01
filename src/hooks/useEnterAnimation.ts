import { useCallback, useRef } from 'react';

/**
 * 一次性入场动画（Web Animations API）— 对齐 Hermes use-enter-animation.ts
 *
 * 返回 callback ref：元素首次挂载时播放一次，已播放过的节点不重播。
 * 用 el.animate 而非 CSS transition/@starting-style，因为：
 * - 流式 delta 不断使祖先状态失效，CSS 过渡可能在无关后代上重触发
 * - @starting-style 只在 DOM 插入时生效，消息生命周期内的样式重启会重放
 * - el.animate 与 CSS 规则churn无关：播一次、结束、完毕
 *
 * animationKey 去重（虚拟化列表滚动重挂载/会话切换时不重播），
 * 上限 2048 条 LRU 防内存膨胀；尊重 prefers-reduced-motion；
 * StrictMode 下用 microtask 确认元素存活才记录"已播放"。
 */
const playedAnimationKeys = new Set<string>();
const playedAnimationOrder: string[] = [];
const MAX_TRACKED_KEYS = 2048;

function hasPlayedAnimation(key: string): boolean {
  return playedAnimationKeys.has(key);
}

function rememberPlayedAnimation(key: string): void {
  if (playedAnimationKeys.has(key)) return;

  playedAnimationKeys.add(key);
  playedAnimationOrder.push(key);

  if (playedAnimationOrder.length > MAX_TRACKED_KEYS) {
    const evicted = playedAnimationOrder.shift();
    if (evicted) playedAnimationKeys.delete(evicted);
  }
}

function scheduleMicrotask(cb: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(cb);
    return;
  }
  void Promise.resolve().then(cb);
}

export function useEnterAnimation(enabled: boolean, animationKey?: string): (el: HTMLElement | null) => void {
  const enabledRef = useRef(enabled);
  const keyRef = useRef(animationKey);

  enabledRef.current = enabled;
  keyRef.current = animationKey;

  return useCallback((el: HTMLElement | null) => {
    if (!el || !enabledRef.current || typeof window === 'undefined') return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const key = keyRef.current;
    if (key && hasPlayedAnimation(key)) return;

    el.animate(
      [
        { opacity: 0, transform: 'translateY(0.375rem)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
    );

    if (key) {
      // StrictMode 下首次挂载可能立即被卸载：元素存活到 microtask 才记录
      scheduleMicrotask(() => {
        if (el.isConnected) rememberPlayedAnimation(key);
      });
    }
  }, []);
}
