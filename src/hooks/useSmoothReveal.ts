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
 *
 * 🔴 段落边界回退（对齐 Hermes 无残段揭示）：揭示是字符截断，若截断点恰在
 *   空行分隔的新段落开头（\n\n 后本帧只揭示了 <add 个字符），则回退到段落
 *   边界 —— 新段落要么不出现，要么一次性出现足够内容。消除"第二段 1-3 个
 *   字"的短段瞬态（Hermes 直接渲染完整累积文本，段落结构即时完整，无此问题）。
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

      // 进度推进到本帧终点（不回退，保证收敛）；显示文本可按段落边界回退
      const progressEnd = shownRef.current.length + add;
      let displayEnd = progressEnd;

      // 🔴 段落边界回退：截断点之后若紧跟空行分隔的新段落，且本帧只揭示了
      // 新段落开头的一小段（< add 字符），回退到 \n\n 之前 —— 新段落整段
      // 揭示（或本帧不显示），避免"接"这种 1-3 字残段单独成段的视觉劈开。
      // 仅流式未结束时生效；最后帧（progressEnd 达末尾）始终显示完整文本。
      if (progressEnd < targetRef.current.length) {
        const tail = targetRef.current.slice(0, progressEnd);
        const m = tail.match(/\n\n([^\n]*)$/);
        if (m && m[1].length > 0 && m[1].length < add) {
          displayEnd = progressEnd - m[1].length;
        }
      }

      shownRef.current = targetRef.current.slice(0, progressEnd);
      setDisplayed(targetRef.current.slice(0, displayEnd));

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
