import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 🔴 round-96：`requestForBot` 本机路由回归。
 *
 * 真断点：`method` 是 **RPC 名**（`'bot.rooms.grant.pending'` /
 * `'bot_relay.outbox.drain'` …），而 bridge 的 `COMMAND_TO_WS_METHOD` 是
 * **legacy snake_case 命令表**（`bot_rooms_grant_pending: 'bot.rooms.grant.pending'`），
 * `call()` 按 **key** 查表 → 传 RPC 名恒查不到 → 抛
 * "No WS/HTTP mapping" → 被 `bot-relay.ts` 各处 `catch {}` 静默吞掉。
 *
 * 后果（本机作 authority = 建房的那台机器，最常见）：本机网关收不到远端
 * roster、outbox 永不被拉、跨机 dispatch 队列永不拉取、peer 结果永远写不回、
 * 授权握手永不发起 —— 跨机群聊整条链静默死亡。
 *
 * 这条断言把"本机分支与远端分支同构（直接 sendRpc）"钉死：一旦有人把
 * `call()` 放回来，本测试立刻红。
 */
const mocks = vi.hoisted(() => ({ sendRpc: vi.fn(), call: vi.fn() }));

vi.mock('./ws-client', () => ({
  getWsClient: () => ({ sendRpc: mocks.sendRpc }),
  GatewayWsClient: class {},
}));

// bridge 的 legacy 命令表路径——本机 RPC 名**绝不**该走到这里
vi.mock('../utils/bridge', () => ({ call: mocks.call }));

import { requestForBot } from './connections';

describe('requestForBot 本机路由（null route）', () => {
  beforeEach(() => {
    mocks.sendRpc.mockReset();
    mocks.call.mockReset();
    mocks.sendRpc.mockResolvedValue({ ok: true });
    // 真实 bridge 对未知命令的行为：抛错
    mocks.call.mockRejectedValue(new Error('[bridge] No WS/HTTP mapping for command'));
  });

  it('直接把 RPC 名交给 ws-client，不经 legacy 命令表', async () => {
    const res = await requestForBot(null, 'bot.rooms.grant.pending', {
      refresh_margin_secs: 300,
    });
    expect(res).toEqual({ ok: true });
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.sendRpc).toHaveBeenCalledWith(
      'bot.rooms.grant.pending',
      { refresh_margin_secs: 300 },
      undefined,
    );
  });

  it('timeoutMs 透传给 sendRpc（长处理器预算）', async () => {
    await requestForBot(undefined, 'bot_relay.deliver', { profile: 'x' }, 60_000);
    expect(mocks.sendRpc).toHaveBeenCalledWith(
      'bot_relay.deliver',
      { profile: 'x' },
      60_000,
    );
  });

  it('跨机链路用到的每个 RPC 名在本机都可达（回归清单）', async () => {
    const rpcs = [
      'bots.roster',
      'bot_relay.roster.sync',
      'bot_relay.outbox.drain',
      'bot_relay.deliver',
      'bot_relay.reply',
      'bot.rooms.peer.dispatch',
      'bot.rooms.peer.status',
      'bot.rooms.peer.cancel',
      'bot.rooms.peer_dispatches.pending',
      'bot.rooms.peer_dispatches.state',
      'bot.rooms.peer_result',
      'bot.rooms.replica.ingest',
      'bot.rooms.grant.pending',
      'bot.rooms.grant.register',
    ];
    for (const rpc of rpcs) {
      await expect(requestForBot(null, rpc, {})).resolves.toBeTruthy();
    }
    expect(mocks.sendRpc).toHaveBeenCalledTimes(rpcs.length);
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
