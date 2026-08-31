/**
 * 数字/大小格式化 — 全局统一入口
 *
 * 🔴 2026-09-01 重复收敛（审查：格式化函数复制粘贴）：
 * - token 数 M/K 缩写此前复制 4 份（ContextBar / CardContextGauge / UsagePanel /
 *   ProviderCard，且小写 k / 大写 K / toLocaleString 兜底 / '—' 兜底 4 种变体）
 * - 文件大小此前内联散落 4 处（useImageAttachments / PreviewFilePane ×2 /
 *   TaskDrawer），单位语义各异（固定 KB / 固定 MB / 混合）
 *
 * 展示统一决策：
 * - formatCompactTokens：上下文紧凑风格（134.8k），供 ContextBar/CardContextGauge
 * - formatTokens：整数千分位风格（128K，空值 '—'），供 UsagePanel/ProviderCard
 * - formatFileSize：自适应单位（<1KB → B，<1MB → KB，≥1MB → MB），替代各处
 *   手写单位换算（原 PreviewFilePane 大文件显示 "2048.0 KB" 统一为 "2.0 MB"）
 */

/** 紧凑数字（134800 → "134.8k"）— 上下文条/卡片仪表风格 */
export function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/** token 数格式化（128000 → "128K"；空值/非正数 → "—"）— 用量面板/服务商卡片风格 */
export function formatTokens(n: number | undefined | null): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** 文件大小自适应格式化（<1KB → B，<1MB → KB，≥1MB → MB） */
export function formatFileSize(bytes: number, decimals?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(decimals ?? 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(decimals ?? 1)} MB`;
}
