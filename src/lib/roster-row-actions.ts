/**
 * roster-row-actions — 私聊分组行的**动作实现**（编辑由 UI 层发起，此处只做数据动作）。
 *
 * 🔴 2026-09-16 round-116 P2b（Agent 面板整合）：从旧 `components/BotsPane.tsx`
 * （`:588-645`）抽出，供新面板复用：
 *   - `duplicateRosterAgent`：复制 Agent（对齐 Hermes bot-row 的 Duplicate）
 *   - `setRosterPrefs`：花名册展示偏好（置顶 / 隐藏）
 *
 * 与旧实现的语义**逐条保持**：
 *   - 名占用集**按连接作用域**（远端同名 profile 不挡本机复制）
 *   - 远端行骑 owner 连接（`requestForBot` 的 route）；本机 route = null
 *   - 展示偏好写服务端（`profiles.set_roster_prefs`，落 profile.yaml）⇒ 写后重拉花名册
 *   - 隐藏是**纯展示**：隐藏的 Agent 照常工作、照常可被 @、照常留在群里
 *
 * ⚠️ 迁移期：旧 `BotsPane` 内的同名局部函数保持不动（P5 随该文件删除）；
 * 两处调用的是同一批 lib/RPC，不存在判据分叉。
 */
import { requestForBot } from '../services/connections';
import { duplicateAgent } from './bot-duplicate';
import { getUnionRoster, refreshUnionRoster, type UnionRosterRow } from '../plugins/bots/state';

/** 复制一个 Agent（建 profile → 复制外观 → 标题加 (copy)；**不含聊天记录**）。返回新 profile 名。
 *
 *  名占用集**自己从 store 取**（同一连接下的全部 profile）——调用方无需知道花名册，
 *  也避免"只传自己一行"导致重名判定失效（`nextDuplicateName` 会退化成总是 -2）。 */
export async function duplicateRosterAgent(row: UnionRosterRow): Promise<string> {
  const takenProfiles = getUnionRoster()
    .filter((r) => r.connectionId === row.connectionId)
    .map((r) => r.entry.profile);

  const name = await duplicateAgent(
    {
      profile: row.entry.profile,
      displayName: row.entry.display_name,
      description: row.entry.description ?? null,
      look: { color: row.entry.color ?? null, avatarKey: row.entry.avatar_key ?? null },
    },
    row.isRemote ? { connectionId: row.connectionId, profile: 'default' } : null,
    requestForBot,
    takenProfiles,
  );

  // 写后重拉：新行随 store 广播出现（唯一写入口，组件不再各自 fetch）
  await refreshUnionRoster();
  return name;
}

/** 改 Agent 的展示偏好（服务端才是 source of truth）。 */
export async function setRosterPrefs(
  row: UnionRosterRow,
  patch: { pinned?: boolean; hidden?: boolean },
): Promise<void> {
  // 🔴 round-111：路由按**行**（含 connectionId）决定——跨连接同名时不能按 profile 猜
  await requestForBot(
    row.isRemote ? { connectionId: row.connectionId, profile: 'default' } : null,
    'profiles.set_roster_prefs',
    { name: row.entry.profile, ...patch },
  );
  await refreshUnionRoster();
}
