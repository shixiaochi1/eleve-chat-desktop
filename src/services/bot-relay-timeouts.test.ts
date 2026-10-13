/**
 * 🔴 round-111b（自查修复）：前端两个"预算"常量与后端 `eleve_core::bot` 的
 * **同源可校验性**。
 *
 * 背景：round-111 把后端的 relay 预算拆名并同源派生，r119（botmode 审查
 * P1-2）进一步与 Hermes `tools/bot_relay.py:44-68` 逐值对齐：
 *   - `TURN_WAIT_SECONDS` = 120（lock wait；ELEVE 无锁，为跨厂商兼容余量）
 *   - `TURN_ATTEMPT_TIMEOUT_SECONDS` = 600（relay deliver 单轮）
 *   - `TURN_MAX_ATTEMPTS` = 2
 *   - `DELIVER_SETTLEMENT_MARGIN_SECONDS` = 180
 *   - `DELIVER_WORST_CASE_SECONDS` = 120+600×2+180 = 1500
 *   - `REPLY_WAIT_SECONDS` = 1560+1500+60 = 3120（覆盖 re-offer + 两次 deliver）
 *   - `ROOM_TURN_TIMEOUT_SECONDS` = 1830（hosted room 单成员轮）
 *
 * 前端两处数字必须跟着走：
 *   - `RELAY_DELIVER_TIMEOUT_MS`  = 后端 deliver 侧最坏（1500s）；
 *   - `PEER_POLL_BUDGET_MS`      = 后端**单轮成员轮**预算（1830s =
 *     `ROOM_TURN_TIMEOUT_SECONDS`），**不是** relay attempt（600s）、也**不是**
 *     发送侧 relay waiter（3120s）。
 *
 * 此前两处都是模块内字面量 + 注释声明"与后端对齐"——后端常量一改，前端**静默**
 * 不同步（无编译期信号、无测试信号）。本文件把漂移变成响亮的失败，手法与后端
 * `assert_eq!(TURN_ATTEMPT_TIMEOUT_SECONDS, 600)` 一致。
 *
 * 改后端常量时（`crates/eleve-core/src/bot.rs`）：同步改这里 + `bot-relay.ts`。
 */
import { describe, it, expect } from 'vitest';
import { PEER_POLL_BUDGET_MS, RELAY_DELIVER_TIMEOUT_MS } from './bot-relay';

describe('relay 预算常量与后端同源（crates/eleve-core/src/bot.rs）', () => {
  it('RELAY_DELIVER_TIMEOUT_MS = 120+600×2+180 = 1500s（= DELIVER_WORST_CASE_SECONDS，Hermes 同值）', () => {
    expect(
      RELAY_DELIVER_TIMEOUT_MS,
      '若后端 TURN_WAIT_SECONDS / TURN_ATTEMPT_TIMEOUT_SECONDS / TURN_MAX_ATTEMPTS / ' +
        'DELIVER_SETTLEMENT_MARGIN_SECONDS 变了，这里必须同步——' +
        '前端预算小于后端最坏会让"重试轮"的回信无人收件；与 Hermes ' +
        'relay-budget.ts 分叉会让混搭组网下客户端先放弃',
    ).toBe((120 + 600 * 2 + 180) * 1000);
    expect(RELAY_DELIVER_TIMEOUT_MS).toBe(1_500_000);
  });

  it('PEER_POLL_BUDGET_MS = 1830s（= ROOM_TURN_TIMEOUT_SECONDS，单成员轮；不是 attempt 600s / waiter 3120s）', () => {
    expect(
      PEER_POLL_BUDGET_MS,
      'peer.status 轮询等的是目标网关的**单成员轮**（ROOM_TURN_TIMEOUT_SECONDS=1830s）；' +
        'TURN_ATTEMPT_TIMEOUT_SECONDS(600s) 是 relay attempt，REPLY_WAIT_SECONDS(3120s) ' +
        '是发送侧 relay waiter，别拿它们当这里的目标',
    ).toBe(1830 * 1000);
  });

  it('两个预算互不相同（deliver 预算 < 成员轮预算，各自跟随不同的后端常量）', () => {
    expect(PEER_POLL_BUDGET_MS).toBeGreaterThan(RELAY_DELIVER_TIMEOUT_MS);
  });
});
