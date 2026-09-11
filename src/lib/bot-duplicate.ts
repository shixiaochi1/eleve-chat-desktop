/**
 * 复制 Agent（对齐 Hermes `profile-ops.ts:301 duplicateBot`）。
 *
 * Hermes 的三步（实现体）：
 * 1. 算空闲名 `<base>-2`/`-3`/…（**截 base、绝不截后缀**——见下面 #19 注释）；
 * 2. `profiles.create { name, clone_from: base, description }`；
 * 3. 复制**外观**（shape/color/image）+ 标题加 `(copy)`；
 *    **不复制** chat / created（"Those belong to the original bot."）。
 *
 * ELEVE 的对应物：
 * - `profiles.create` 的等价参数是 `clone_source`（复制 config.yaml/.env/SOUL.md + skills）；
 * - 外观 = `color`（随 create 传）+ 头像（自定义图走 `get_avatar`→`set_avatar`，
 *   预设 key 走 `set_avatar_key`；后端两者**互斥**，所以必须按源的样子二选一）；
 * - 标题 = `display_name`（ELEVE 无独立 title 字段）。
 *
 * 远端行照 Hermes 的 `requestForBot(bot, 'profiles.create', …)` 路由到 owner 连接。
 */

/** profile 名上限——逐字对齐 `eleve_config::profile::PROFILE_NAME_RE`
 *  （`^[a-z0-9][a-z0-9_-]{0,63}$` = 1 + 63 = 64）。Hermes 同值（64）。 */
export const MAX_PROFILE_NAME_LEN = 64;

/** 依赖注入的 RPC 通道（生产 = `requestForBot`；测试 = 假实现）。 */
export type DupRpc = <T = unknown>(
  route: { connectionId: string; profile: string } | null,
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

/**
 * 求一个空闲的复制名：`<base>-2`、`<base>-3`…（最多试到 99）。
 *
 * 🔴 **截断的是 base，不是拼好的串**（Hermes 原注释 #19）：对拼好的串做
 * `slice(0, 64)` 会把 `-2` 后缀切掉，候选名与 base 永久相撞 → 死循环。
 *
 * 返回 `null` = 100 个候选都被占用（对齐 Hermes 抛 "No free name for the duplicate."）。
 */
export function nextDuplicateName(base: string, isTaken: (name: string) => boolean): string | null {
  for (let n = 2; n < 100; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_PROFILE_NAME_LEN - suffix.length) + suffix;
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}

/** 复制件的标题：`X (copy)`（源无标题则留空——对齐 Hermes
 *  `title: meta.title ? \`${meta.title} (copy)\` : ''`）。 */
export function copyTitle(displayName: string | null | undefined): string {
  const name = (displayName || '').trim();
  return name ? `${name} (copy)` : '';
}

/** 源 Agent 的「外观」——复制时要传过去的那部分。 */
export interface DuplicateLook {
  color?: string | null;
  avatarKey?: string | null;
}

/** 一次性创建 profile 的入参（与 Hermes 的 `profiles.create` 调用同形）。 */
export interface CreateProfileArgs {
  name: string;
  cloneSource: string;
  displayName?: string;
  description?: string;
  color?: string;
}

/**
 * 复制一个 Agent。返回新 profile 名。
 *
 * 顺序刻意与 Hermes 一致：**先建 profile，再补外观**——反过来的话
 * `set_avatar`/`set_color` 会写到一个还不存在的 profile 上（后端
 * `set_avatar` 会报 `Profile not found`）。外观补写失败**不让整体失败**
 * （profile 已经建好了，抛错只会让用户以为没复制成功）。
 */
export async function duplicateAgent(
  src: {
    profile: string;
    displayName?: string | null;
    description?: string | null;
    look: DuplicateLook;
  },
  route: { connectionId: string; profile: string } | null,
  rpc: DupRpc,
  takenProfiles: readonly string[],
): Promise<string> {
  const taken = new Set(takenProfiles);
  const name = nextDuplicateName(src.profile, (n) => taken.has(n));
  if (!name) {
    throw new Error(`没有可用的名称：${src.profile}-2 … -99 都已被占用`);
  }

  await rpc(route, 'profiles.create', {
    name,
    clone_source: src.profile,
    ...(copyTitle(src.displayName) ? { display_name: copyTitle(src.displayName) } : {}),
    ...(src.description ? { description: src.description } : {}),
    ...(src.look.color ? { color: src.look.color } : {}),
  });

  // —— 外观补写（best-effort）——
  try {
    const avatar = await rpc<{ exists?: boolean; data?: string }>(route, 'profiles.get_avatar', {
      name: src.profile,
    });
    if (avatar?.exists && avatar.data) {
      // 自定义图：复制图片本身（set_avatar 会顺带清掉 avatar_key，与源的互斥态一致）
      await rpc(route, 'profiles.set_avatar', { name, data: avatar.data });
    } else if (src.look.avatarKey) {
      await rpc(route, 'profiles.set_avatar_key', { name, avatar_key: src.look.avatarKey });
    }
  } catch {
    // 外观是增强项：profile 已建成，不因头像失败推翻整次复制
  }

  return name;
}
