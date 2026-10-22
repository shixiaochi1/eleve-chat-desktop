import { describe, it, expect } from 'vitest';
import {
  platformFromSessionId,
  isBotPlatformSessionId,
  isRestorableProfilePointer,
  latestSessionForDomain,
} from './session';

/**
 * 🔴 2026-10-22 P0-1 回归：Bot Chat 的 sid 也是 `agent:<p>:` 前缀，不能作为
 * profile 指针（`profile_session_map`）的恢复目标——否则点 Agent 卡片会落进
 * 同一条 Bot Chat（卡片与私聊行"重复"的直接原因）。
 */
describe('sessionId 域判定（bot 与普通会话）', () => {
  it('platformFromSessionId 解析平台段', () => {
    expect(platformFromSessionId('agent:default:ws:a1b2c3d4')).toBe('ws');
    expect(platformFromSessionId('agent:default:bot:deadbeef')).toBe('bot');
    expect(platformFromSessionId('agent:ocean:telegram:12345')).toBe('telegram');
  });

  it('platformFromSessionId 对旧格式/非法输入返回 null', () => {
    expect(platformFromSessionId(null)).toBeNull();
    expect(platformFromSessionId('')).toBeNull();
    expect(platformFromSessionId('a1b2c3d4-uuid-legacy')).toBeNull();
    expect(platformFromSessionId('agent:default')).toBeNull();
  });

  it('isBotPlatformSessionId 只认 bot 域', () => {
    expect(isBotPlatformSessionId('agent:default:bot:deadbeef')).toBe(true);
    expect(isBotPlatformSessionId('agent:default:ws:deadbeef')).toBe(false);
    expect(isBotPlatformSessionId('legacy-uuid')).toBe(false);
  });

  it('isRestorableProfilePointer 排除 bot 会话', () => {
    // 普通会话：同 profile 才可用
    expect(isRestorableProfilePointer('agent:default:ws:aaaa', 'default')).toBe(true);
    expect(isRestorableProfilePointer('agent:ocean:ws:aaaa', 'default')).toBe(false);
    // Bot Chat：同 profile 也必须拒绝（这是"卡片点进 DM"的根因）
    expect(isRestorableProfilePointer('agent:default:bot:aaaa', 'default')).toBe(false);
    // 旧格式无法判定归属 → 放行（兼容历史数据）
    expect(isRestorableProfilePointer('legacy-uuid', 'default')).toBe(true);
    // 空值
    expect(isRestorableProfilePointer(null, 'default')).toBe(false);
  });

  it('latestSessionForDomain 不会把 Bot Chat 当成项目最新会话', () => {
    const sessions = [
      // Bot Chat 更"新"，但它在 bot 域，不参与项目域候选
      { id: 'agent:default:bot:newer', cwd: 'C:\\proj', last_active: 200 },
      { id: 'agent:default:ws:older', cwd: 'C:\\proj', last_active: 100 },
      { id: 'agent:other:ws:x', cwd: 'C:\\proj', last_active: 300 },
    ];
    const hit = latestSessionForDomain(sessions, 'default', 'C:\\proj');
    expect(hit?.id).toBe('agent:default:ws:older');
  });

  it('latestSessionForDomain 路径边界（C:\\projAB 不属于 C:\\proj）', () => {
    const sessions = [
      { id: 'agent:default:ws:ab', cwd: 'C:\\projAB', last_active: 300 },
      { id: 'agent:default:ws:in', cwd: 'C:\\proj\\sub', last_active: 100 },
    ];
    const hit = latestSessionForDomain(sessions, 'default', 'C:\\proj');
    expect(hit?.id).toBe('agent:default:ws:in');
  });
});
