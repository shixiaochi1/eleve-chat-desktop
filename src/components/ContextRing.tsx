/**
 * ContextRing — 环形上下文占用指示（宫格卡片工具状态栏用）
 *
 * SVG circle + stroke-dasharray 实现，无第三方依赖。
 * 色语义对齐 ContextBar：<80% 绿 / ≥80% 黄 / ≥95% 红。
 * 中心可放小号百分比文本（可选）。
 */
import { memo } from 'react';

interface ContextRingProps {
  /** 0-100 */
  pct: number;
  /** 直径 px（默认 16） */
  size?: number;
  /** 覆盖色（默认按 pct 语义色） */
  color?: string;
  /** 是否显示中心百分比文本 */
  showText?: boolean;
}

export function ringColor(pct: number): string {
  const p = Math.min(Math.max(pct, 0), 100);
  if (p >= 95) return 'color-mix(in srgb, var(--ui-red) 70%, white)';
  if (p >= 80) return 'color-mix(in srgb, var(--ui-yellow) 70%, white)';
  return 'color-mix(in srgb, var(--ui-green) 70%, white)';
}

export const ContextRing = memo(function ContextRing({ pct, size = 16, color, showText = false }: ContextRingProps) {
  const p = Math.min(Math.max(pct, 0), 100);
  const stroke = 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - p / 100);
  const c = color || ringColor(pct);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`上下文占用 ${p.toFixed(1)}%`}>
      {/* 底环 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ui-stroke-tertiary)"
        strokeWidth={stroke}
        opacity={0.5}
      />
      {/* 占用环 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={c}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 300ms ease, stroke 300ms ease' }}
      />
      {showText && (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={size * 0.32}
          fontWeight={600}
          fill="var(--ui-text-tertiary)"
        >
          {Math.round(p)}
        </text>
      )}
    </svg>
  );
});

export default ContextRing;
