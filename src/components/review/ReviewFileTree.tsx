/**
 * ReviewFileTree — 审查域变更文件列表/树（🔴 2026-09-05 对齐 Hermes
 * app/right-sidebar/review/file-tree.tsx + tree-data.ts，ELEVE tailwind token 重绘）
 *
 * - 双布局：扁平列表（VS Code SCM List，文件名 + 暗色父目录）/ 目录树
 *   （compact 单链折叠，目录聚合 +/-）；目录展开态复用 sidebar-node-open
 *   持久化（对齐 $sidebarWorkspaceNodeOpen，id 前缀 `review:`）
 * - 文件行：状态色图标 + 名称 + 悬停显 stage/unstage/revert + 增删计数 +
 *   staged 绿点（对齐 file-tree.tsx:423-462）
 * - 单击 = 选中看 diff；双击 = 预览面板打开文件（对齐 openInPreview）
 */
import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, Plus, Minus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildReviewFlatList,
  buildReviewTree,
  flattenReviewRows,
  type ReviewFlatRow,
  type ReviewTreeNode,
} from '@/lib/review-tree';
import { setWorkspaceNodeOpen, useWorkspaceNodeOpenMap } from '@/lib/sidebar-node-open';
import { getCurrentSessionCwd } from '@/lib/session-cwd';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { openPreview } from '@/store/preview';
import { notifyError } from '@/utils/notifications';
import {
  selectReviewFile,
  stageReviewFile,
  unstageReviewFile,
  requestRevert,
  useReview,
  type ReviewFile,
} from '@/store/review';

/** 状态字母 → 图标着色（A 新增绿 / D 删除红 / ? 未跟踪灰 / 其余变更黄） */
function statusTone(status: string): string {
  switch (status) {
    case 'A':
      return 'text-success';
    case 'D':
      return 'text-destructive';
    case '?':
      return 'text-muted-foreground/50';
    default:
      return 'text-warning';
  }
}

/** 增删计数（对齐 Hermes DiffCount：+N 绿 / −M 红，零值暗显） */
function DiffCount({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-[0.64rem] leading-4 tabular-nums">
      {added > 0 && <span className="text-success">+{added}</span>}
      {removed > 0 && <span className="text-destructive">−{removed}</span>}
    </span>
  );
}

/** 行内悬停动作（stage/unstage + revert，对齐 file-tree.tsx:423-445） */
function RowActions({ file }: { file: ReviewFile }) {
  return (
    <span className="hidden shrink-0 items-center gap-0.5 group-hover/review-row:flex">
      <button
        aria-label={file.staged ? '取消暂存' : '暂存'}
        className="grid size-4 place-items-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
        title={file.staged ? '取消暂存' : '暂存'}
        onClick={(e) => {
          e.stopPropagation();
          void (file.staged ? unstageReviewFile(file.path) : stageReviewFile(file.path)).catch((err) =>
            notifyError(err, file.staged ? '取消暂存' : '暂存'),
          );
        }}
      >
        {file.staged ? <Minus size={11} /> : <Plus size={11} />}
      </button>
      <button
        aria-label="丢弃变更"
        className="grid size-4 place-items-center rounded text-muted-foreground/70 transition-colors hover:text-destructive"
        title="丢弃变更"
        onClick={(e) => {
          e.stopPropagation();
          requestRevert(file.path);
        }}
      >
        <RotateCcw size={11} />
      </button>
    </span>
  );
}

function FileRow({ node, depth }: { node: ReviewTreeNode; depth: number }) {
  const { selectedPath } = useReview();
  const file = node.file!;
  const selected = selectedPath === file.path;

  const openInPreview = () => {
    const resolved = normalizeOrLocalPreviewTarget(file.path, getCurrentSessionCwd());
    if (resolved) openPreview(resolved, 'tool-result');
    else notifyError(new Error(file.path), '无法打开文件预览');
  };

  return (
    <div
      aria-selected={selected}
      className={cn(
        'group/review-row row-hover flex h-6 select-none items-center gap-1.5 rounded-md pr-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
        selected && 'bg-accent/50 text-foreground',
      )}
      style={{ paddingLeft: `${depth * 12 + 6}px` }}
      onClick={() => void selectReviewFile(file)}
      onDoubleClick={openInPreview}
      title={file.path}
    >
      <span className={cn('shrink-0 font-mono text-[0.64rem] font-semibold', statusTone(file.status))}>
        {file.status}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 shrink truncate" title={node.name}>
          {node.name}
        </span>
        {node.dir && (
          <span className="min-w-0 shrink-[9999] truncate text-[0.68rem] text-muted-foreground/60" title={node.dir}>
            {node.dir}
          </span>
        )}
      </span>
      <RowActions file={file} />
      <span className={cn('group-hover/review-row:hidden')}>
        <DiffCount added={node.added} removed={node.removed} />
      </span>
      {file.staged && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success/70" title="已暂存" />
      )}
    </div>
  );
}

function DirRow({ node, depth, open, onToggle }: { node: ReviewTreeNode; depth: number; open: boolean; onToggle: () => void }) {
  return (
    <div
      className="group/review-row row-hover flex h-6 select-none items-center gap-1.5 rounded-md pr-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={onToggle}
      title={node.id}
    >
      <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
      {open ? <FolderOpen size={13} className="shrink-0" /> : <Folder size={13} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <DiffCount added={node.added} removed={node.removed} />
    </div>
  );
}

export default function ReviewFileTree() {
  const { files, treeMode } = useReview();
  const openMap = useWorkspaceNodeOpenMap();

  // 树模式默认全开（对齐 Hermes defaultOpen=true；展开态持久 key 前缀 review:）
  const isOpen = (id: string) => openMap[`review:${id}`] ?? true;
  const toggle = (id: string) => setWorkspaceNodeOpen(`review:${id}`, !isOpen(id));

  const rows: ReviewFlatRow[] = useMemo(() => {
    if (treeMode === 'list') {
      return buildReviewFlatList(files).map((node) => ({ node, depth: 0 }));
    }
    return flattenReviewRows(buildReviewTree(files, true), isOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, treeMode, openMap]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
      {rows.map(({ node, depth }) =>
        node.isDir ? (
          <DirRow key={node.id} node={node} depth={depth} open={isOpen(node.id)} onToggle={() => toggle(node.id)} />
        ) : (
          <FileRow key={node.id} node={node} depth={depth} />
        ),
      )}
    </div>
  );
}
