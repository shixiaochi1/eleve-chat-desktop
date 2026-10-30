/**
 * MCP 运行状态的展示映射（纯函数，便于单测）。
 *
 * 为什么独立成模块：这五个分支里有两条**容易做错且后果明显**的判断——
 * - `parked` 是空闲回收（工具仍在、下次调用自动唤醒），绝不能用错误色
 * - `configured`（配了还没连）与 `failed`（连不上）是同一种灰/红吗？不是：
 *   前者是过程状态，后者需要用户动作
 *
 * 抽出来之后，UI 只负责渲染，判断逻辑可以被测试钉住。
 */
import type { McpServerStatus } from './api';

export interface McpStatusBadge {
  text: string;
  /** Tailwind 颜色类（bg-x/10 text-x），与设置页其它徽标同语言 */
  cls: string;
  title: string;
}

const NEUTRAL = 'bg-muted-foreground/10 text-muted-foreground';

/**
 * 把运行状态映射成徽标。
 *
 * `status` 为 `undefined` 有两种来源：网关运行态不可用（`runtimeReady=false`），
 * 或者这台服务器刚配上还没进入发现。两者都不能显示成"连不上"。
 */
export function describeMcpStatus(
  status: McpServerStatus | undefined,
  runtimeReady: boolean,
): McpStatusBadge {
  if (!status) {
    return runtimeReady
      ? {
          text: '未连接',
          cls: NEUTRAL,
          title: '尚未完成发现（可在右上角重载 MCP）',
        }
      : {
          text: '运行态未知',
          cls: NEUTRAL,
          title: '网关运行状态不可用',
        };
  }

  // 🔴 失败优先于 parked：连接已经挂了就不该显示"待唤醒"
  if (!status.disabled && status.status === 'failed') {
    const reasonText =
      status.reason === 'auth_required'
        ? '需要重新授权（eleve mcp auth login）'
        : status.reason === 'blocked'
          ? '配置被安全校验拦截，未启动'
          : '连接失败，详见网关日志';
    return { text: '连接失败', cls: 'bg-destructive/10 text-destructive', title: reasonText };
  }

  if (status.parked) {
    return {
      text: '空闲待唤醒',
      cls: 'bg-warning/10 text-warning',
      title: '长时间未调用已释放连接，下次调用会自动重建（工具仍然可用）',
    };
  }

  if (status.connected) {
    return {
      text: `已连接 · ${status.tools} 工具`,
      cls: 'bg-success/10 text-success',
      title: '连接正常',
    };
  }

  if (status.disabled) {
    return {
      text: '已停用',
      cls: NEUTRAL,
      title: '配置中 enabled: false',
    };
  }

  return { text: '未连接', cls: NEUTRAL, title: '已配置，尚未连接' };
}
