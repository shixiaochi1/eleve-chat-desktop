/**
 * StateDot — 子 Agent 运行状态指示点（复刻 DSH ui-primitives StateDot）
 *
 * 🔴 2026-08-15 对齐 DSH（SubagentCatalogAction 触发器按钮）：
 * running 态渲染"像素追逐"动画——3x3 网格外圈 8 个 2px 格子顺时针依次点亮，
 * 阶梯式亮度衰减（1 → 0.6 → 0.35 → 0.15，离散 hold 无补间，复古手感）。
 * 颜色走 --ui-blue（DSH 原为 --dsw-static-deepseek-450 蓝）。
 *
 * DSH 源码基准：packages/client/ui-primitives/src/StateDot.tsx（持续态 ongoing）。
 * 这里只做 running/idle 两态（ELEVE 监控按钮场景），idle 时返回占位保持按钮宽度稳定。
 */

/** 3x3 网格外圈 8 格坐标（2px 像素，10px viewBox，顺时针，自左上角起）——与 DSH MATRIX_CELLS 一致 */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
];

export default function StateDot({ running, size = 10 }: { running: boolean; size?: number }) {
  if (!running) {
    // 占位：无运行任务时保留同尺寸空槽，避免按钮宽度跳动
    return <span className="inline-block flex-none" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <svg
      className="state-dot-matrix flex-none"
      width={size}
      height={size}
      viewBox="0 0 10 10"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {MATRIX_CELLS.map(([x, y], index) => (
        <rect
          key={`${x}-${y}`}
          className="state-dot-cell"
          x={x}
          y={y}
          width="2"
          height="2"
          /* 负延迟错相：让追逐从挂载即生效（DSH 同款 index*-125ms） */
          style={{ animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
        />
      ))}
    </svg>
  );
}
