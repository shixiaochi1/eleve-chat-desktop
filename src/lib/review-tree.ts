/**
 * review-tree — Review 域变更文件树构建（🔴 2026-09-05 对齐 Hermes
 * app/right-sidebar/review/tree-data.ts：目录聚合 +/−、目录先序、
 * compact 单链折叠、扁平行展开）
 */

/** 单个变更文件（store/review.ts ReviewFile 的树构建视角） */
export interface ReviewTreeFile {
  path: string;
  added: number;
  removed: number;
  status: string;
  staged: boolean;
}

// 树节点：目录聚合后代 +/−（折叠的文件夹也读得出总变更量，Codex 同款）
export interface ReviewTreeNode {
  id: string;
  name: string;
  isDir: boolean;
  added: number;
  removed: number;
  /** 扁平列表文件行：父目录（相对路径），暗色展示 */
  dir?: string;
  file?: ReviewTreeFile;
  children?: ReviewTreeNode[];
}

// 扁平变更列表（VS Code SCM "List" 视图）：一行一个文件，文件名 + 暗色父目录，
// 按路径排序。无目录节点。
export function buildReviewFlatList(files: ReviewTreeFile[]): ReviewTreeNode[] {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const segments = file.path.split('/').filter(Boolean);
      const name = segments.pop() ?? file.path;

      return {
        id: file.path,
        name,
        dir: segments.join('/'),
        isDir: false,
        added: file.added,
        removed: file.removed,
        file,
      };
    });
}

interface MutableDir {
  id: string;
  name: string;
  added: number;
  removed: number;
  dirs: Map<string, MutableDir>;
  files: ReviewTreeNode[];
}

const makeDir = (id: string, name: string): MutableDir => ({
  id,
  name,
  added: 0,
  removed: 0,
  dirs: new Map(),
  files: [],
});

// 由扁平列表构建文件夹层级。compact 时单子目录链折叠为一行（`a/b/c`），
// VS Code / Codex 对稀疏树的渲染同款。
export function buildReviewTree(files: ReviewTreeFile[], compact = true): ReviewTreeNode[] {
  const root = makeDir('', '');

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    const fileName = segments.pop() ?? file.path;
    let dir = root;

    dir.added += file.added;
    dir.removed += file.removed;

    let prefix = '';

    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let child = dir.dirs.get(segment);

      if (!child) {
        child = makeDir(prefix, segment);
        dir.dirs.set(segment, child);
      }

      child.added += file.added;
      child.removed += file.removed;
      dir = child;
    }

    dir.files.push({
      id: file.path,
      name: fileName,
      isDir: false,
      added: file.added,
      removed: file.removed,
      file,
    });
  }

  const finalize = (dir: MutableDir): ReviewTreeNode[] => {
    const dirNodes: ReviewTreeNode[] = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        let node: ReviewTreeNode = {
          id: child.id,
          name: child.name,
          isDir: true,
          added: child.added,
          removed: child.removed,
          children: finalize(child),
        };

        // 单链折叠：唯一子节点是目录 → 合并名（parent/child）
        while (compact && node.children?.length === 1 && node.children[0].isDir) {
          const only = node.children[0];
          node = { ...only, name: `${node.name}/${only.name}` };
        }

        return node;
      });

    const fileNodes = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));

    return [...dirNodes, ...fileNodes];
  };

  return finalize(root);
}

// 虚拟化判定用的节点总数上界（含全部后代）——单个文件夹挂几万个 untracked
// 文件时顶层只有一个节点，但仍属重列表
export function countAllNodes(nodes: ReviewTreeNode[]): number {
  let total = 0;

  for (const node of nodes) {
    total += 1;

    if (node.children) {
      total += countAllNodes(node.children);
    }
  }

  return total;
}

// 展开为当前可见行：目录仅在 open（按 node id）时贡献子行，每行带嵌套深度
export interface ReviewFlatRow {
  node: ReviewTreeNode;
  depth: number;
}

export function flattenReviewRows(
  nodes: ReviewTreeNode[],
  isOpen: (id: string) => boolean,
  depth = 0,
  rows: ReviewFlatRow[] = [],
): ReviewFlatRow[] {
  for (const node of nodes) {
    rows.push({ depth, node });

    if (node.isDir && node.children && isOpen(node.id)) {
      flattenReviewRows(node.children, isOpen, depth + 1, rows);
    }
  }

  return rows;
}
