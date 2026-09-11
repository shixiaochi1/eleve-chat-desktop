/**
 * 🔴 round-111b（自查修复）：前端两个"预算"常量与后端 `eleve_core::bot` 的
 * **同源可校验性**。
 *
 * 背景：round-111 把后端的 relay 预算拆名并同源派生（`TURN_ATTEMPT_TIMEOUT_SECONDS`
 * / `TURN_MAX_ATTEMPTS` / `DELIVER_WORST_CASE_SECONDS` / `REPLY_WAIT_SECONDS`），
 * 前端有两处数字必须跟着走：
 *   - `RELAY_DELIVER_TIMEOUT_MS`  ≥ 后端 deliver 侧最坏（1860s）；
 *   - `PEER_POLL_BUDGET_MS`      = 后端**单轮**成员轮预算（900s），**不是**
 *     发送侧 relay waiter（1920s）。
 *
 * 此前两处都是模块内字面量 + 注释声明"与后端对齐"——后端常量一改，前端**静默**
 * 不同步（无编译期信号、无测试信号）。本文件把漂移变成响亮的失败，手法与后端
 * `assert_eq!(TURN_ATTEMPT_TIMEOUT_SECONDS, 900)` 一致。
 *
 * 改后端常量时（`crates/eleve-core/src/bot.rs`）：同步改这里 + `bot-relay.ts`。
 */
import { describe, it, expect } from 'vitest';
import { PEER_POLL_BUDGET_MS, RELAY_DELIVER_TIMEOUT_MS } from './bot-relay';

describe('relay 预算常量与后端同源（crates/eleve-core/src/bot.rs）', () => {
  it('RELAY_DELIVER_TIMEOUT_MS = 900×2+60 = 1860s（= DELIVER_WORST_CASE_SECONDS）', () => {
    expect(
      RELAY_DELIVER_TIMEOUT_MS,
      '若后端 TURN_ATTEMPT_TIMEOUT_SECONDS / TURN_MAX_ATTEMPTS / ' +
        'DELIVER_SETTLEMENT_MARGIN_SECONDS 变了，这里必须同步——' +
        '前端预算小于后端最坏会让"重试轮"的回信无人收件',
    ).toBe((900 * 2 + 60) * 1000);
    expect(RELAY_DELIVER_TIMEOUT_MS).toBe(1_860_000);
  });

  it('PEER_POLL_BUDGET_MS = 900s（= TURN_ATTEMPT_TIMEOUT_SECONDS，单轮；不是 REPLY_WAIT_SECONDS）', () => {
    expect(
      PEER_POLL_BUDGET_MS,
      'peer.status 轮询等的是目标网关的**单轮**成员轮（TURN_ATTEMPT_TIMEOUT_SECONDS）；' +
        'REPLY_WAIT_SECONDS(1920s) 是发送侧 relay waiter 预算，别拿它当这里的目标',
    ).toBe(900 * 1000);
  });

  it('两个预算互不相同（曾经同值 900，拆分后必须能区分）', () => {
    expect(RELAY_DELIVER_TIMEOUT_MS).toBeGreaterThan(PEER_POLL_BUDGET_MS);
  });
});
