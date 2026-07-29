/**
 * session_id ↔ profile 解析工具
 *
 * session_id 格式: agent:<profile>:<platform>:<uuid>
 * 例: agent:default:ws:a1b2c3d4, agent:ocean:ws:e5f6g7h8
 */

/** session_id → profile 解析（agent:<profile>:...，main 归一为 default） */
export function profileFromSessionId(sid: string | undefined | null): string | null {
  if (!sid) return null;
  const parts = sid.split(':');
  if (parts[0] !== 'agent' || parts.length < 2) return null;
  const p = parts[1];
  return p === 'main' ? 'default' : p;
}

/** 校验 session_id 是否属于指定 profile（不匹配 = 指针污染） */
export function sessionIdMatchesProfile(sid: string | undefined | null, profile: string): boolean {
  const owner = profileFromSessionId(sid);
  // 非 agent: 前缀的旧格式 session_id 无法判定归属 → 放行（兼容）
  if (owner === null) return true;
  return owner === profile;
}
