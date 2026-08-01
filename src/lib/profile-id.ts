/**
 * profile-id — Agent ID 生成与校验
 *
 * 北极星：用户只填昵称，ID 自动生成（可读、有意义、唯一），后端零改动。
 *
 * ID 规则（对齐后端 PROFILE_NAME_RE = ^[a-z0-9][a-z0-9_-]{0,63}$）：
 *   - 英文/数字昵称 → 直接规范化（小写、非法字符转连字符、截断）
 *   - 中文昵称 → 动态 import pinyin-pro 转拼音（懒加载，主包零成本）
 *   - 与现有 Agent 冲突 → 追加 -2/-3 后缀
 *
 * 校验：正则 + 保留名（default/eleve/test/tmp/root/sudo，对齐后端 RESERVED_NAMES）
 */

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(['default', 'eleve', 'test', 'tmp', 'root', 'sudo']);

/** 校验 ID 合法性，返回错误文案（合法返回 null） */
export function validateProfileId(id: string): string | null {
  const v = id.trim();
  if (!v) return 'ID 不能为空';
  if (v === 'default') return 'default 是内置 Agent，不能使用';
  if (RESERVED.has(v)) return `「${v}」是保留名称，请换一个`;
  if (!ID_RE.test(v)) return '仅限小写字母/数字/连字符/下划线，且首字符不能是符号';
  return null;
}

/** 纯 ASCII 昵称 → 规范化 ID（同步） */
function asciiSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** 含中文昵称 → 拼音 ID（懒加载 pinyin-pro，只在用到时加载 ~140KB gzip） */
async function pinyinSlug(input: string): Promise<string> {
  const { pinyin } = await import('pinyin-pro');
  const arr = pinyin(input, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }) as string[];
  return arr
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** 昵称 → 候选 ID（可能为空：全符号等无法生成时需用户手动填） */
export async function generateProfileId(nickname: string): Promise<string> {
  const raw = nickname.trim();
  if (!raw) return '';
  // 纯 ASCII → 不用拼音库
  if (/^[\x00-\x7F]+$/.test(raw)) return asciiSlug(raw);
  // 含中文 → 懒加载拼音（混合如「小虎AI」由 nonZh 保留非中文）
  const slug = await pinyinSlug(raw);
  return slug || asciiSlug(raw);
}

/** 与现有 Agent 去重：冲突追加 -2/-3… */
export function ensureUniqueId(base: string, existing: string[]): string {
  if (!base) return '';
  const set = new Set(existing.map((s) => s.toLowerCase()));
  if (!set.has(base)) return base;
  for (let i = 2; i <= 999; i++) {
    const cand = `${base}-${i}`;
    if (!set.has(cand) && ID_RE.test(cand)) return cand;
  }
  return base;
}
