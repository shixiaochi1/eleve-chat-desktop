import { describe, it, expect, vi } from 'vitest';
import {
  MAX_PROFILE_NAME_LEN,
  copyTitle,
  duplicateAgent,
  nextDuplicateName,
  type DupRpc,
} from './bot-duplicate';

/** 对齐 Hermes `profile-ops.ts:301 duplicateBot`。 */
describe('nextDuplicateName — 复制件的空闲名（Hermes #19 的截断陷阱）', () => {
  it('从 -2 起、跳过已占用', () => {
    expect(nextDuplicateName('coder', () => false)).toBe('coder-2');
    expect(nextDuplicateName('coder', (n) => n === 'coder-2')).toBe('coder-3');
    expect(nextDuplicateName('coder', (n) => n === 'coder-2' || n === 'coder-3')).toBe('coder-4');
  });

  it('🔴 截断的是 base 而不是拼好的串——后缀必须活着', () => {
    // 对拼好的串做 slice(0, 64) 会把 "-2" 切掉 → 候选与 base 永久相撞（Hermes #19）
    const base = 'a'.repeat(MAX_PROFILE_NAME_LEN);
    const name = nextDuplicateName(base, () => false);
    expect(name).not.toBeNull();
    expect(name!.length).toBeLessThanOrEqual(MAX_PROFILE_NAME_LEN);
    expect(name!.endsWith('-2')).toBe(true);
    expect(name!.endsWith('-99')).toBe(false);
  });

  it('100 个候选全被占用 → null（调用方抛"没有可用的名称"）', () => {
    expect(nextDuplicateName('coder', () => true)).toBeNull();
  });
});

describe('copyTitle — 复制件标题（Hermes `\${title} (copy)`）', () => {
  it('有标题加 (copy)，无标题留空', () => {
    expect(copyTitle('代码助手')).toBe('代码助手 (copy)');
    expect(copyTitle('')).toBe('');
    expect(copyTitle(null)).toBe('');
    expect(copyTitle(undefined)).toBe('');
    expect(copyTitle('   ')).toBe('');
  });
});

describe('duplicateAgent — 编排（建 profile → 补外观）', () => {
  const src = {
    profile: 'coder',
    displayName: '代码助手',
    description: '写代码的',
    look: { color: '#ff0000', avatarKey: 'cat' },
  };

  function fakeRpc(result?: (method: string) => unknown) {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const rpc = vi.fn(async (_route: unknown, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return (result?.(method) ?? {}) as never;
    }) as unknown as DupRpc;
    return { rpc, calls };
  }

  it('建 profile：clone_source + (copy) 标题 + 描述 + 颜色', async () => {
    const { rpc, calls } = fakeRpc();
    const name = await duplicateAgent(src, null, rpc, ['coder']);

    expect(name).toBe('coder-2');
    const create = calls.find((c) => c.method === 'profiles.create');
    expect(create?.params).toMatchObject({
      name: 'coder-2',
      clone_source: 'coder',
      display_name: '代码助手 (copy)',
      description: '写代码的',
      color: '#ff0000',
    });
  });

  it('自定义头像优先：get_avatar 有图 → set_avatar（不传 avatar_key）', async () => {
    const { rpc, calls } = fakeRpc((m) =>
      m === 'profiles.get_avatar' ? { exists: true, data: 'data:image/png;base64,AAA' } : {},
    );
    await duplicateAgent(src, null, rpc, []);

    expect(calls.map((c) => c.method)).toEqual([
      'profiles.create',
      'profiles.get_avatar',
      'profiles.set_avatar',
    ]);
    expect(calls[2].params).toMatchObject({
      name: 'coder-2',
      data: 'data:image/png;base64,AAA',
    });
  });

  it('无自定义图 → 退回预设 avatar_key（后端两者互斥，不能都写）', async () => {
    const { rpc, calls } = fakeRpc((m) => (m === 'profiles.get_avatar' ? { exists: false } : {}));
    await duplicateAgent(src, null, rpc, []);

    expect(calls.map((c) => c.method)).toEqual([
      'profiles.create',
      'profiles.get_avatar',
      'profiles.set_avatar_key',
    ]);
    expect(calls[2].params).toMatchObject({ name: 'coder-2', avatar_key: 'cat' });
  });

  it('外观补写失败**不**推翻整次复制（profile 已建成）', async () => {
    const rpc = vi.fn(async (_r: unknown, method: string) => {
      if (method === 'profiles.get_avatar') throw new Error('boom');
      return {} as never;
    }) as unknown as DupRpc;

    await expect(duplicateAgent(src, null, rpc, [])).resolves.toBe('coder-2');
  });

  it('名被占满 → 抛错，且**不建半成品**（create 一次都没发）', async () => {
    const { rpc, calls } = fakeRpc();
    const all = new Set<string>();
    for (let n = 2; n < 100; n++) all.add(`coder-${n}`);

    await expect(duplicateAgent(src, null, rpc, [...all])).rejects.toThrow('没有可用的名称');
    expect(calls).toHaveLength(0);
  });

  it('路由透传：远端行骑 owner 连接（Hermes requestForBot(bot, …)）', async () => {
    const seen: unknown[] = [];
    const rpc = vi.fn(async (route: unknown, _m: string, _p: Record<string, unknown>) => {
      seen.push(route);
      return {} as never;
    }) as unknown as DupRpc;

    await duplicateAgent(src, { connectionId: 'conn-1', profile: 'default' }, rpc, []);
    expect(seen[0]).toEqual({ connectionId: 'conn-1', profile: 'default' });
  });
});
