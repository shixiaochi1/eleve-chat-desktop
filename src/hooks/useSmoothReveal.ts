import { useEffect, useRef, useState } from 'react';

/**
 * 流式文本平滑揭示 — 对齐 Hermes useSmoothReveal（markdown-text.tsx）
 *
 * 作用：把突发的文本到达（bursty arrival）解耦成平滑的逐帧揭示，
 * 文字像打字机一样流出，而不是每 33ms 整段跳变。
 *
 * 机制（与 Hermes 完全一致）：
 * - 比例排空：每帧揭示 backlog 的一个比例切片，保证在 ~REVEAL_DRAIN_MS
 *   内收敛（无论积压多大）
 * - 每帧上限：单帧最多 REVEAL_MAX_CHARS_PER_FRAME 字符，防止大段文本
 *   一次性砸出来像一块石板
 * - 提交下限：~33ms 最小提交间隔（2 帧），把渲染管线调用频率减半，
 *   视觉上仍流畅
 * - 循环门控在 backlog 上（不是 isRunning）：流式在揭示中途结束时，
 *   继续把尾部排完而不是直接快照跳变
 * - 非延续变化（重新生成/切换消息）：text 不以 shown 开头时，
 *   isRunning 中从空重启，否则直接快照替换
 */
const REVEAL_DRAIN_MS = 500;
const REVEAL_MAX_CHARS_PER_FRAME = 30;
const REVEAL_MIN_COMMIT_MS = 33;

export function useSmoothReveal(text: string, isRunning: boolean): string {
  const [displayed, setDisplayed] = useState(isRunning ? '' : text);
  const targetRef = useRef(text);
  const shownRef = useRef(displayed);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  shownRef.current = displayed;
  targetRef.current = text;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 非延续变化（重新生成/历史切换）：流式中从空重启，否则快照替换
    if (!text.startsWith(shownRef.current)) {
      shownRef.current = isRunning ? '' : text;
      setDisplayed(shownRef.current);
    }

    if (shownRef.current.length >= text.length || frameRef.current !== null) {
      return;
    }

    lastTickRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = now - lastTickRef.current;

      // 未到提交下限则跳过本帧（backlog 数学是 dt 比例的，延后提交会揭示更多）
      if (dt < REVEAL_MIN_COMMIT_MS) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      lastTickRef.current = now;

      const remaining = targetRef.current.length - shownRef.current.length;
      const add = Math.min(
        remaining,
        // dt 缩放，使每帧上限在任何提交节奏下等价于旧的 30 字符/帧
        Math.ceil((REVEAL_MAX_CHARS_PER_FRAME * dt) / 16.7),
        Math.max(1, Math.ceil((remaining * dt) / REVEAL_DRAIN_MS))
      );

      shownRef.current = targetRef.current.slice(0, shownRef.current.length + add);
      setDisplayed(shownRef.current);

      frameRef.current = shownRef.current.length < targetRef.current.length ? requestAnimationFrame(tick) : null;
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [text, isRunning]);

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return displayed;
}
