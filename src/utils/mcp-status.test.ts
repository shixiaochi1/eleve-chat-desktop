import { describe, it, expect } from 'vitest';
import { describeMcpStatus } from './mcp-status';
import type { McpServerStatus } from './api';

function status(overrides: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    name: 'github',
    transport: 'http',
    status: 'connected',
    connected: true,
    disabled: false,
    tools: 3,
    parked: false,
    ...overrides,
  };
}

describe('describeMcpStatus', () => {
  it('已连接时显示工具数', () => {
    const badge = describeMcpStatus(status({ tools: 12 }), true);
    expect(badge.text).toBe('已连接 · 12 工具');
    expect(badge.cls).toContain('success');
  });

  it('parked 用警告色而不是错误色（工具仍可用）', () => {
    const badge = describeMcpStatus(status({ connected: false, parked: true, tools: 0 }), true);
    expect(badge.text).toBe('空闲待唤醒');
    expect(badge.cls).toContain('warning');
    expect(badge.cls).not.toContain('destructive');
    expect(badge.title).toContain('自动重建');
  });

  it('失败优先于 parked：连接挂了就不是"待唤醒"', () => {
    const badge = describeMcpStatus(
      status({ connected: false, parked: true, status: 'failed', reason: 'check_failed' }),
      true,
    );
    expect(badge.text).toBe('连接失败');
    expect(badge.cls).toContain('destructive');
  });

  it('auth_required 与 blocked 的提示文案不同', () => {
    expect(
      describeMcpStatus(status({ connected: false, status: 'failed', reason: 'auth_required' }), true)
        .title,
    ).toContain('重新授权');
    expect(
      describeMcpStatus(status({ connected: false, status: 'failed', reason: 'blocked' }), true).title,
    ).toContain('安全校验');
  });

  it('停用状态不显示成故障', () => {
    const badge = describeMcpStatus(
      status({ connected: false, disabled: true, status: 'disabled' }),
      true,
    );
    expect(badge.text).toBe('已停用');
    expect(badge.cls).not.toContain('destructive');
  });

  it('configured（配了但还没连）与 failed 区分开', () => {
    const badge = describeMcpStatus(
      status({ connected: false, status: 'configured', tools: 0 }),
      true,
    );
    expect(badge.text).toBe('未连接');
    expect(badge.cls).not.toContain('destructive');
  });

  it('没有运行态时按 runtime_ready 区分文案', () => {
    expect(describeMcpStatus(undefined, true).text).toBe('未连接');
    expect(describeMcpStatus(undefined, false).text).toBe('运行态未知');
  });
});
