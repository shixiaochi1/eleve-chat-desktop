import { describe, it, expect } from 'vitest';
import { selectWorkspaceDomain, workspaceDomainLabel } from './workspace-domain';

/**
 * 🔴 P2-9：右栏根的**唯一来源**。此前是三目表达式就地决定（群聊 ''、
 * bot chat sessionCwd、其余 panelRoot），终端/预览又各自取值，导致"一个抽屉
 * 三种根"。这里锁住选择器语义，防止后续再散落。
 */
describe('selectWorkspaceDomain（右栏域选择器）', () => {
  it('群聊主区 → room 域，无单一目录', () => {
    const d = selectWorkspaceDomain({
      viewMode: 'bots',
      sessionId: 'agent:default:ws:aaaa',
      sessionCwd: 'C:\\ws',
      projectRoot: 'C:\\proj',
    });
    expect(d).toEqual({ kind: 'room', root: null, sessionId: null });
  });

  it('Bot Chat 借道 → session 域，根 = 会话 cwd', () => {
    const d = selectWorkspaceDomain({
      viewMode: 'single',
      sessionId: 'agent:default:bot:aaaa',
      sessionCwd: 'C:\\bot-ws',
      projectRoot: 'C:\\proj',
    });
    expect(d.kind).toBe('session');
    expect(d.root).toBe('C:\\bot-ws');
  });

  it('远端 Bot Chat（无本地 cwd）→ session 域但根为 null（空态，不冒充本地目录）', () => {
    const d = selectWorkspaceDomain({
      viewMode: 'single',
      sessionId: 'agent:default:bot:remote',
      sessionCwd: null,
      projectRoot: 'C:\\proj',
    });
    expect(d.kind).toBe('session');
    expect(d.root).toBeNull();
  });

  it('普通会话 → project 域，根 = 项目路径', () => {
    const d = selectWorkspaceDomain({
      viewMode: 'single',
      sessionId: 'agent:default:ws:aaaa',
      sessionCwd: 'C:\\ws',
      projectRoot: 'C:\\proj',
    });
    expect(d).toEqual({
      kind: 'project',
      root: 'C:\\proj',
      sessionId: 'agent:default:ws:aaaa',
    });
  });

  it('项目根不属于当前 Agent（调用方传 null）→ 空态，不显示旧 Agent 目录', () => {
    const d = selectWorkspaceDomain({
      viewMode: 'single',
      sessionId: 'agent:default:ws:aaaa',
      sessionCwd: 'C:\\ws',
      projectRoot: null,
    });
    expect(d.kind).toBe('project');
    expect(d.root).toBeNull();
  });

  it('域徽标文案', () => {
    expect(workspaceDomainLabel({ kind: 'project', root: null, sessionId: null })).toBe('项目');
    expect(workspaceDomainLabel({ kind: 'session', root: null, sessionId: 'x' })).toBe('会话');
    expect(workspaceDomainLabel({ kind: 'room', root: null, sessionId: null })).toBe('群聊');
  });
});
