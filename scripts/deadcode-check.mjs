#!/usr/bin/env node
/**
 * 死代码门禁（dead-code gate）
 *
 * 为什么要它：`tsc --noUnusedLocals` 只报**符号级**（本文件内未读）；
 * 「**整个文件没人 import**」它完全看不到，而这类才是最危险的
 * （历史上 KanbanPanel / SessionsPanel 各自 1000+ 行、零消费者，却仍被
 *  反复"修 bug" —— 2026-09-17 审计记录 docs/frontend-deadcode-audit-20260917.md）。
 *
 * 两级判定：
 *   ① 文件级：从 `src/main.tsx` 出发做 BFS 可达性（含级联孤儿，比"零入度"更严）
 *   ② 符号级（可选 --symbols）：跑 tsc --noUnusedLocals --noUnusedParameters
 *
 * 豁免机制：文件头部含 `@deprecated 未挂载` 标记的 → 视为**已登记孤儿**，放过。
 *   ⇒ 两种失败：
 *      - 未登记的死文件（新增孤儿，没人管）
 *      - 标记过期（文件已重新可达，但标记还留着 → 会误导人）
 *
 * 用法：
 *   node scripts/deadcode-check.mjs              # 文件级
 *   node scripts/deadcode-check.mjs --symbols    # 附符号级统计（慢，需 npx tsc）
 *   node scripts/deadcode-check.mjs --warn-only  # 只报不失败
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const ENTRY = join(SRC, 'main.tsx');
const MARK = '@deprecated 未挂载';
/** tsconfig 的路径别名（`@/x` → `src/x`）——不处理会误判为孤儿 */
const ALIASES = [['@/', 'src/']];
const args = new Set(process.argv.slice(2));
const WARN_ONLY = args.has('--warn-only');

const posix = (p) => relative(ROOT, p).split('\\').join('/');

// ── 收集生产源文件（排除测试与 .d.ts：它们不是运行时图的一部分）────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const fileSet = new Set(files);

// ── 解析 import / re-export / 动态 import ───────────────────────────
const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const DYN_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveSpec(spec) {
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) return tryPath(join(ROOT, target + spec.slice(alias.length)));
  }
  return null;
}
function tryPath(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
/** 返回该文件依赖的仓内文件（绝对路径） */
function depsOf(file) {
  const text = readFileSync(file, 'utf8');
  const specs = new Set();
  for (const re of [FROM_RE, SIDE_RE, DYN_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) specs.add(m[1]);
  }
  const out = new Set();
  for (const spec of specs) {
    const resolved = spec.startsWith('.') ? tryPath(resolve(dirname(file), spec)) : resolveSpec(spec);
    if (resolved && fileSet.has(resolved)) out.add(resolved);
  }
  return out;
}

// ── ① 可达性 BFS ────────────────────────────────────────────────────
if (!existsSync(ENTRY)) {
  console.error(`❌ 找不到入口 ${posix(ENTRY)}`);
  process.exit(2);
}
const reachable = new Set([ENTRY]);
const queue = [ENTRY];
while (queue.length) {
  for (const dep of depsOf(queue.pop())) {
    if (!reachable.has(dep)) {
      reachable.add(dep);
      queue.push(dep);
    }
  }
}
const unreachable = files.filter((f) => !reachable.has(f));

// ── ② 标记核对 ──────────────────────────────────────────────────────
const hasMark = (f) => readFileSync(f, 'utf8').includes(MARK);
const lineCount = (f) => readFileSync(f, 'utf8').split('\n').length;

const registered = [];   // 已登记孤儿（有标记 + 不可达）
const unregistered = []; // ❌ 新增孤儿（不可达 + 无标记）
const stale = [];        // ⚠️ 标记过期（可达 + 有标记）
for (const f of unreachable) (hasMark(f) ? registered : unregistered).push(f);
for (const f of reachable) if (hasMark(f)) stale.push(f);

// ── 输出 ────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(5);
console.log(`\n[deadcode] 入口 ${posix(ENTRY)} · 生产源文件 ${files.length} 个 · 可达 ${reachable.size} 个\n`);

console.log(`✅ 已登记孤儿 ${registered.length} 个（带 \`${MARK}\` 标记，已豁免）`);
let regLines = 0;
for (const f of registered.sort()) {
  regLines += lineCount(f);
  console.log(`   ${pad(lineCount(f))} 行  ${posix(f)}`);
}
console.log(`   ── 合计 ≈ ${regLines} 行\n`);

if (stale.length) {
  console.log(`⚠️  标记过期 ${stale.length} 个（文件**已可达**，标记应删除）`);
  for (const f of stale.sort()) console.log(`   ${posix(f)}`);
  console.log('   ⇒ 说明有人把它接回入口了：请删掉文件头的 @deprecated 标记。\n');
}
if (unregistered.length) {
  console.log(`❌ 未登记的死文件 ${unregistered.length} 个（无消费者且无标记）`);
  for (const f of unregistered.sort()) console.log(`   ${pad(lineCount(f))} 行  ${posix(f)}`);
  console.log('   ⇒ 三选一：① 接回入口  ② 整条链删除  ③ 打 `@deprecated 未挂载` 标记\n');
} else {
  console.log('❌ 未登记的死文件 0 个\n');
}

// ── ③ 可选：符号级（tsc）─────────────────────────────────────────────
if (args.has('--symbols')) {
  const { spawnSync } = await import('node:child_process');
  console.log('[deadcode] 跑符号级扫描（tsc --noUnusedLocals --noUnusedParameters）…');
  const r = spawnSync('npx', ['tsc', '--noEmit', '--noUnusedLocals', '--noUnusedParameters', '-p', 'tsconfig.json'], {
    cwd: ROOT, encoding: 'utf8', shell: true,
  });
  const hits = (r.stdout || '').split('\n').filter((l) => /error TS(6133|6192|6196|6198)/.test(l));
  console.log(`[deadcode] 符号级未使用告警 ${hits.length} 条（不作为门禁失败项，仅统计）\n`);
}

const failed = unregistered.length > 0 || stale.length > 0;
console.log(failed ? '[deadcode] 未通过 ❌' : '[deadcode] 通过 ✅');
process.exit(failed && !WARN_ONLY ? 1 : 0);
