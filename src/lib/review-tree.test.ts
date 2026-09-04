import { describe, expect, it } from 'vitest';

import {
  buildReviewFlatList,
  buildReviewTree,
  countAllNodes,
  flattenReviewRows,
  type ReviewTreeFile,
} from './review-tree';

const file = (path: string, added = 1, removed = 0): ReviewTreeFile => ({
  path,
  added,
  removed,
  status: 'M',
  staged: false,
});

describe('buildReviewTree', () => {
  it('nests files under their folders and sorts dirs before files', () => {
    const tree = buildReviewTree([file('src/a.ts'), file('readme.md'), file('src/b.ts')], false);

    expect(tree.map((n) => n.name)).toEqual(['src', 'readme.md']);
    expect(tree[0].children?.map((n) => n.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('aggregates folder churn from descendants', () => {
    const tree = buildReviewTree([file('src/a.ts', 3, 1), file('src/deep/b.ts', 1, 2)], false);
    const src = tree[0];

    expect(src.added).toBe(4);
    expect(src.removed).toBe(3);
  });

  it('collapses single-child directory chains when compact', () => {
    const tree = buildReviewTree([file('a/b/c.ts')], true);

    expect(tree.map((n) => n.name)).toEqual(['a/b']);
    expect(tree[0].children?.[0].name).toBe('c.ts');
  });

  it('keeps chain uncollapsed when compact is false', () => {
    const tree = buildReviewTree([file('a/b/c.ts')], false);

    expect(tree[0].name).toBe('a');
    expect(tree[0].children?.[0].name).toBe('b');
  });
});

describe('buildReviewFlatList', () => {
  it('sorts by path and carries the parent dir', () => {
    const rows = buildReviewFlatList([file('src/z.ts'), file('src/a.ts')]);

    expect(rows.map((n) => n.name)).toEqual(['a.ts', 'z.ts']);
    expect(rows[0].dir).toBe('src');
  });
});

describe('flattenReviewRows', () => {
  it('contributes children only for open dirs and tracks depth', () => {
    const tree = buildReviewTree([file('a/1.ts'), file('b/2.ts')], false);
    const openAll = () => true;
    const rows = flattenReviewRows(tree, openAll);

    expect(rows.map((r) => r.node.name)).toEqual(['a', '1.ts', 'b', '2.ts']);
    expect(rows[1].depth).toBe(1);

    const rowsClosed = flattenReviewRows(tree, () => false);
    expect(rowsClosed.map((r) => r.node.name)).toEqual(['a', 'b']);
  });
});

describe('countAllNodes', () => {
  it('counts descendants including nested dirs', () => {
    const tree = buildReviewTree([file('a/b/c.ts'), file('a/d.ts')], false);

    expect(countAllNodes(tree)).toBe(4); // a + a/b + c.ts + d.ts
  });
});
