/**
 * 群聊成员的**唯一派生入口**（创建弹层 BotsPane + 房间设置 BotsView + 房间头
 * 可达性共用）。
 *
 * 🔴 round-95 修的真断点：此前两处成员选择器都只列**本地** bot
 * （`BotsPane.localBots` / `BotsView.localBots` = `filter(!isRemote)`），
 * 远端 bot 根本选不到；本地不足 2 个时创建弹层直接提示"只有 N 个本地
 * Agent，群聊至少需要 2 个"——**即使远端连着一堆 bot 也建不了群**。
 *
 * 而后端**支持**远端成员：`driver.rs:1575` 用 `transport.is_local(profile)`
 * 分流，`run_remote_member_turn` 再用 `bot_relay::resolve_remote_target`
 * 按 profile/handle 匹配 Desktop 推送的 remote roster。缺的只是 UI 入口。
 *
 * 为什么是独立文件而不是塞进某个组件：两处 UI 结构不同（checkbox 勾选 vs
 * 「+ 添加」按钮行），但**"谁能被选、怎么显示、为什么被禁用"**必须是同一份
 * 答案——第二套实现迟早与这一套漂移（参见 roomRowReads 的同样取舍）。
 */

import type { UnionRosterRow } from '../plugins/bots/state';

export interface MemberPickRow {
  /** 提交给后端的键（后端按 `profile` 匹配本地注册 / 远端 roster） */
  profile: string;
  handle: string;
  displayName: string;
  isRemote: boolean;
  /** 远端连接展示名（跨连接同名消歧；本地行为空串） */
  connectionLabel: string;
  /**
   * 是否可选。
   * 本地行恒可选；远端行**不可达即禁用**——`run_remote_member_turn` 对
   * roster 中缺席/离线的目标会立刻结构化失败（"not reachable — no live
   * remote-roster entry"），放进房间等于每一轮固定空转。
   * 不造一个必然失败的房间，比事后让用户猜"为什么这个成员从不回话"好。
   */
  disabled: boolean;
  /** 禁用原因（tooltip） */
  disabledReason: string;
  /** 列表 key：跨连接同名时 profile 会撞，必须带 connectionId */
  key: string;
}

/**
 * 派生可选成员行。
 *
 * 排序：本机在前、远端按连接名再按 handle——群聊绝大多数成员是本机 bot，
 * 把它们放在随手可及的位置，同时保证远端行稳定不跳动（数组 order 变化会让
 * checkbox 行在勾选瞬间"跳位"）。
 */
export function pickableMembers(roster: UnionRosterRow[]): MemberPickRow[] {
  const local: MemberPickRow[] = [];
  const remote: MemberPickRow[] = [];

  for (const r of roster) {
    const e = r.entry;
    const row: MemberPickRow = {
      profile: e.profile,
      handle: e.handle,
      displayName: e.display_name || e.handle || e.profile,
      isRemote: r.isRemote,
      connectionLabel: r.isRemote ? r.connectionLabel : '',
      disabled: r.isRemote && !r.reachable,
      disabledReason: r.isRemote && !r.reachable ? `远端连接「${r.connectionLabel}」不可达` : '',
      key: `${r.connectionId}::${e.profile}`,
    };
    (r.isRemote ? remote : local).push(row);
  }

  local.sort((a, b) => a.handle.localeCompare(b.handle));
  remote.sort(
    (a, b) => a.connectionLabel.localeCompare(b.connectionLabel) || a.handle.localeCompare(b.handle),
  );

  return [...local, ...remote];
}

/** 成员行的展示标签：`@handle`（远端追加连接名消歧）。 */
export function memberPickLabel(row: MemberPickRow): string {
  return row.isRemote ? `@${row.handle} · ${row.connectionLabel}` : `@${row.handle}`;
}

/**
 * 房间成员可达性（对齐 Hermes `bot-row.tsx` GroupRow 的 "N of M available"）。
 *
 * 真值 = union roster 的 `reachable`（远端连接拉取失败 → ghost 行），归并
 * Hermes `botSourceStatus` 的两条不可用判定：
 *   - sourceMissing（名册里查无此人）→ 匹配行数为 0
 *   - sourceReachable === false       → 匹配行全部不可达
 * 任一行可达即可用（同一 profile 可能同时在本机与远端注册）。
 *
 * 🔴 `known`：roster 未加载（空）时返回 false，调用方**必须**据此跳过渲染——
 * 否则首帧把全体成员打成不可用，一片琥珀警示。
 */
/**
 * 按 handle（回退 profile）在 union 花名册里定位成员行——消息气泡的发言者
 * 归属（色块 + 远端连接标签）用它。
 *
 * 跨连接同名时优先返回**可达**的那一行：两个同名 bot 只有一个能说话，选存活
 * 的那个才能给出正确的连接标签。都不可达则取首个（渲染仍带连接标签，用户能
 * 看出是哪个连接）。
 */
export function findMemberRoster(
  roster: UnionRosterRow[],
  handle: string,
  profile?: string,
): UnionRosterRow | null {
  const byHandle = handle ? roster.filter(r => r.entry.handle === handle) : [];
  const pool = byHandle.length
    ? byHandle
    : profile
      ? roster.filter(r => r.entry.profile === profile)
      : [];
  return pool.find(r => r.reachable) ?? pool[0] ?? null;
}

export function memberAvailability(
  members: { profile: string }[],
  roster: UnionRosterRow[],
): { known: boolean; available: number; total: number } {
  const total = members.length;
  if (!roster.length) return { known: false, available: total, total };
  let available = 0;
  for (const m of members) {
    if (roster.some(r => r.entry.profile === m.profile && r.reachable)) available += 1;
  }
  return { known: true, available, total };
}
