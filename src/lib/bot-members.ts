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
 * 🔴 round-111：花名册行的**唯一键**（跨连接同名安全的唯一真值）。
 *
 * 根因：跨连接同名时 `profile` 会撞（本机 `coder` + 远端 `coder`）。任何
 * "按 profile 找行"的写法（`find(r => r.entry.profile === p)`）都恒命中
 * **第一条 = 本机那条**，于是置顶 / 隐藏 / 编辑 / 复制全作用到**错误的连接**
 * ——`setBotPrefs` 的 route 随之指向错误 socket，写的是另一个 Agent 的偏好。
 *
 * 对齐 Hermes `botRosterKey(bot)`（`96ed0e71ea fix(bot-mode): match scoped
 * bot selection in reset guard`，测试注释 *"An identically named bot on
 * another connection must not win the lookup."*）。差别：Hermes 只在
 * `sourceScoped || remoteSource` 时加连接前缀、否则回落 `name`；ELEVE 的
 * union roster **每行恒带 connectionId**（本机 = `LOCAL_CONNECTION_ID`），
 * 故无需回落分支——回落反而会重新引入同名歧义。
 *
 * 与 `MemberPickRow.key` 同式（成员选择器的 checkbox 行也靠它去重）。
 */
export function rosterRowKey(row: UnionRosterRow): string {
  return `${row.connectionId}::${row.entry.profile}`;
}

/** 按花名册唯一键精确取行（`null` / 找不到 → `null`）。
 *
 * 右键菜单、复制等都经此定位——**不要**再写 `find(profile)`。 */
export function findRosterRowByKey(
  rows: UnionRosterRow[],
  key: string | null | undefined,
): UnionRosterRow | null {
  if (!key) return null;
  return rows.find((r) => rosterRowKey(r) === key) ?? null;
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

  // 🔴 round-111b（自查修复）：**路由冲突**的行不可选。
  //
  // 根因：房间成员身份是 **profile 键**的（`RoomMember { member_id, profile,
  // handle }` 无 connectionId；driver 按 `transport.is_local(profile)` 分流，
  // 远端再按 profile 去 remote roster 解析）。于是"同名 profile"在三处都会
  // 静默指向另一个 bot：
  //   - 本机有 `coder` + 远端也有 `coder` → 选远端那行，实际投给**本机**；
  //   - 两台远端都有 `coder` → `resolve_remote_target` 判 Ambiguous，该成员
  //     **每一轮都硬失败**（房间注定空转）。
  // 这与 round-111 行菜单那个真 bug 同族——只是发生在"成员选择态"上。
  //
  // 处理原则同 round-111：**不提供一个必然选错人的入口**，但**不误伤合法能力**——
  // 本机那行照旧可选（它就是路由真值），唯一远程 profile 也照旧可选。
  //
  // ⚠️ 与 Hermes 的差距（已知，非本处可修）：Hermes 的 renderer-owned 建房弹层用
  // `botRosterKey(bot)` 做勾选键，并把每台机器的身份持久化进房间成员
  // （`durableGroupChatMembers`，注释原话 *"cannot rely on the new gateway's
  // name-keyed bot metadata to remain seated in this room"*）。ELEVE 的房间模型
  // 缺这一层（成员不带连接身份）——要真正支持"同名跨机成员"得改成员身份模型 +
  // `bot.rooms.create` 载荷 + driver 分流，属独立工作。
  const byProfile = new Map<string, UnionRosterRow[]>();
  for (const r of roster) {
    const list = byProfile.get(r.entry.profile);
    if (list) list.push(r);
    else byProfile.set(r.entry.profile, [r]);
  }
  /** 该行的路由是否唯一；非空串 = 冲突原因（禁用 tooltip）。 */
  const routingConflict = (r: UnionRosterRow): string => {
    const peers = byProfile.get(r.entry.profile) ?? [];
    if (peers.length <= 1) return '';
    const hasLocal = peers.some((p) => !p.isRemote);
    if (hasLocal) {
      // 本机那行 = 路由真值，保留可选；远端同名行必然被投给本机。
      return r.isRemote
        ? `本机也有 profile「${r.entry.profile}」——成员按 profile 归属，这一行会投给本机那个`
        : '';
    }
    // 全远端且不止一行：按 profile 解析必然 Ambiguous → 每轮硬失败。
    return `多台远端机器都有「${r.entry.profile}」——成员按 profile 归属，无法消歧`;
  };

  for (const r of roster) {
    const e = r.entry;
    const conflict = routingConflict(r);
    const unreachable = r.isRemote && !r.reachable;
    const row: MemberPickRow = {
      profile: e.profile,
      handle: e.handle,
      displayName: e.display_name || e.handle || e.profile,
      isRemote: r.isRemote,
      connectionLabel: r.isRemote ? r.connectionLabel : '',
      disabled: Boolean(conflict) || unreachable,
      disabledReason: conflict
        ? conflict
        : unreachable
          ? `远端连接「${r.connectionLabel}」不可达`
          : '',
      // 🔴 round-111：改走唯一真值（此前是本文件里的同一公式的第二次手写）
      key: rosterRowKey(r),
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
 * 🔴 round-111b：把**房间成员**（`{handle, profile}` —— 身份是 profile 键，
 * 没有 connectionId）解析成花名册里的**路由真值行**。
 *
 * 为什么必须显式优先本机行：真实路由是"本机有这个 profile 就跑本机"
 * （`driver` 的 `transport.is_local(profile)` 分流），所以**本机行才是该成员的
 * 路由真值**，远端同名行只是同一 profile 在另一台机器上的副本。此前两处消费点
 * （`roster-filter::roomMatchesFilters` 的连接过滤、`BotsPane` 的房间活跃度探测）
 * 都写的是 `roster.find(handle||profile)` ——**隐式依赖**花名册"本机行排在最前"
 * 的数组顺序（`fetchUnionRoster` 的实现细节）。顺序一变，语义就静默反了。
 *
 * `undefined` = 花名册里查无此人（ghost/未同步）——调用方自行决定忽略还是降级。
 */
export function findMemberRoutingRow<
  T extends { entry: { handle: string; profile: string }; isRemote?: boolean },
>(roster: readonly T[], m: { handle: string; profile: string }): T | undefined {
  const hit = roster.filter((r) => r.entry.handle === m.handle || r.entry.profile === m.profile);
  return hit.find((r) => !r.isRemote) ?? hit[0];
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
