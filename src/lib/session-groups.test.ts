import { describe, it, expect } from 'vitest';
import {
  groupSessionsByProject,
  isPathWithin,
  normalizeGroupPath,
  countGroupedSessions,
} from './session-groups';

/**
 * 🔴 P2-8 骨架：项目 = 会话列表的分组头。
 * 这些用例锁的是**归属与排序规则**（最容易出错的纯逻辑），UI 只做渲染。
 */
describe('groupSessionsByProject（会话按项目分组）', () => {
  const projects = [
    { id: 'p1', name: '项目A', primary_path: 'C:\\work\\a', updated_at: 100 },
    { id: 'p2', name: '项目B', primary_path: 'C:\\work\\a\\nested', updated_at: 200 },
    { id: 'p3', name: '空项目', primary_path: 'C:\\work\\c', updated_at: 300 },
  ];

  it('路径边界感知：C:\\work\\ab 不属于 C:\\work\\a', () => {
    expect(isPathWithin('C:\\work\\a\\x', 'C:\\work\\a')).toBe(true);
    expect(isPathWithin('C:\\work\\a', 'C:\\work\\a')).toBe(true);
    expect(isPathWithin('C:\\work\\ab', 'C:\\work\\a')).toBe(false);
    expect(isPathWithin(null, 'C:\\work\\a')).toBe(false);
  });

  it('嵌套项目取最长前缀（a\\nested 的会话归 B 不归 A）', () => {
    const groups = groupSessionsByProject(
      [
        { id: 's1', cwd: 'C:\\work\\a\\nested\\deep', last_active: 10 },
        { id: 's2', cwd: 'C:\\work\\a\\other', last_active: 20 },
      ],
      projects,
    );
    const a = groups.find((g) => g.key === 'p1')!;
    const b = groups.find((g) => g.key === 'p2')!;
    expect(a.sessions.map((s) => s.id)).toEqual(['s2']);
    expect(b.sessions.map((s) => s.id)).toEqual(['s1']);
  });

  it('无 cwd / 不在任何项目下 → Home 兜底（Home 恒存在）', () => {
    const groups = groupSessionsByProject(
      [
        { id: 's1', cwd: null, last_active: 10 },
        { id: 's2', cwd: 'D:\\elsewhere', last_active: 20 },
      ],
      projects,
    );
    const home = groups.find((g) => g.isHome)!;
    expect(home.sessions.map((s) => s.id)).toEqual(['s2', 's1']); // 组内按活跃降序
    expect(groups[groups.length - 1].isHome).toBe(true); // Home 恒在末尾
  });

  it('组排序：有会话的项目按组内最新活动降序，空项目按 updated_at 降序', () => {
    const groups = groupSessionsByProject(
      [
        { id: 'sA', cwd: 'C:\\work\\a', last_active: 5 },
        { id: 'sB', cwd: 'C:\\work\\a\\nested', last_active: 99 },
      ],
      projects,
    );
    expect(groups.map((g) => g.key)).toEqual(['p2', 'p1', 'p3', '__home__']);
  });

  it('毫秒/秒级 last_active 混用也能正确排序', () => {
    const groups = groupSessionsByProject(
      [
        { id: 'sec', cwd: 'C:\\work\\a', last_active: 1_700_000_000 }, // 秒
        { id: 'ms', cwd: 'C:\\work\\a', last_active: 1_600_000_000_000 }, // 毫秒（更旧）
      ],
      projects,
    );
    const a = groups.find((g) => g.key === 'p1')!;
    expect(a.sessions.map((s) => s.id)).toEqual(['sec', 'ms']);
  });

  it('countGroupedSessions 统计会话总数（不含分组头）', () => {
    const groups = groupSessionsByProject(
      [
        { id: 's1', cwd: 'C:\\work\\a', last_active: 1 },
        { id: 's2', cwd: null, last_active: 2 },
      ],
      projects,
    );
    expect(countGroupedSessions(groups)).toBe(2);
  });

  it('normalizeGroupPath 归一斜杠/大小写/尾分隔符', () => {
    expect(normalizeGroupPath('C:/Work/A/')).toBe('c:\\work\\a');
    expect(normalizeGroupPath(null)).toBe('');
  });
});
