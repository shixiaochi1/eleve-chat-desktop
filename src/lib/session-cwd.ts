/**
 * session-cwd — 当前会话工作目录全局持有点（🔴 2026-08-28 对齐 Hermes $currentCwd）
 *
 * Hermes：store/session.ts 的 nanostores atom `$currentCwd`，全部预览目标
 * 归一化调用点（markdown #preview 链接 / preview-row / attachments / panes）
 * 都以 `$currentCwd.get()` 为 cwd 来源——相对路径链接据此 join 成绝对路径。
 *
 * ELEVE 等价物：模块级单例（点击时同步读一次即可，无需 React 订阅）。
 * 唯一写入方 = App（sessionCwd state 变化同步）；读取方：
 * - StreamBlocks / ToolEntry：消息流 markdown `#preview` / `file:` 链接点击
 * - AgentCardComposer：附件 pill 点击（对齐 Hermes attachments.tsx:137 传 cwd）
 * - PreviewCenter：空态手动输入（对齐 Hermes panes.tsx:74 传 $currentCwd）
 * - preview-events：preview.open 事件归一化（替代原 App 闭包双轨）
 *
 * 修复的 bug：旧实现 markdown 链接点击不传 cwd → 工具输出相对路径
 * `#preview/src/index.html` 生成相对 file target → 文件读取失败。
 */

let currentSessionCwd: string | null = null;

export function setCurrentSessionCwd(cwd: string | null | undefined): void {
  currentSessionCwd = cwd?.trim() ? cwd : null;
}

export function getCurrentSessionCwd(): string | null | undefined {
  return currentSessionCwd;
}
