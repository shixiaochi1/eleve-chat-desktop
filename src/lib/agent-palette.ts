/**
 * Agent 主题色板（对齐 Hermes PROFILE_COLORS 22 色）
 *
 * 🔴 2026-08-18 主题铁律说明：此为**身份数据色板**（每个 Agent 的辨识色，
 * 跨主题恒定——同一 Agent 在浅色/深色/玻璃下颜色一致才能被认出），
 * 非 UI chrome，不走主题派生；消费方需自行保证色上文字可读
 * （getReadableOnAccent）。
 */
export const AGENT_PALETTE: string[] = [
  '#3498DB', '#1ABC9C', '#2ECC71', '#9B59B6', '#E67E22', '#E74C3C',
  '#16A085', '#2980B9', '#8E44AD', '#27AE60', '#D35400', '#C0392B',
  '#F39C12', '#34495E', '#E84393', '#00B894', '#0984E3', '#6C5CE7',
  '#FD79A8', '#00CEC9', '#FDCB6E', '#636E72',
];
