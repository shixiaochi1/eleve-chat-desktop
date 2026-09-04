import { memo, useMemo } from 'react';
import { ContextFileIcon } from './Icons';
import { cn } from '@/lib/utils';
import { deriveChangedFiles } from '@/lib/changed-files';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { getCurrentSessionCwd } from '@/lib/session-cwd';
import { openPreview } from '@/store/preview';
import { notifyError } from '@/utils/notifications';
import type { ChatMessagePart } from '@/lib/chat-messages';

/**
 * Cursor 风格「N 个文件已修改」汇总卡片（对齐 Hermes ChangedFilesCard）：
 * 每行一个本轮编辑过的文件 + 该文件 +a/-b，收尾最新一轮 assistant 消息。
 * 仅最后一条已落定的 assistant 消息渲染（门控在 MessageRow isLast）。
 *
 * 🔴 2026-09-05 审查联动补齐（对齐 Hermes changed-files-card.tsx 交互语义）：
 * - 文件行可点 → 预览面板打开该文件（对齐 openReviewForPath）；文件有未提交
 *   变更时 PreviewFilePane autoMode 自动落「变更」diff 视图（files_diff 数据）。
 * - 头部「审查更改」→ 打开首个变更文件（对齐 revealReview 的最小档实现；
 *   完整 Review 域——git stage/unstage/revert + ship-bar——另行立项）。
 */
const ChangedFilesCard = memo(function ChangedFilesCard({ parts }: { parts: readonly ChatMessagePart[] }) {
  const files = useMemo(() => deriveChangedFiles(parts), [parts]);

  if (files.length === 0) {
    return null;
  }

  // 相对路径以检测时的会话 cwd 解析回绝对路径（对齐 preview feed 的 cwd 捕获语义）
  const openFileReview = (path: string) => {
    const resolved = normalizeOrLocalPreviewTarget(path, getCurrentSessionCwd());
    if (!resolved) {
      notifyError(new Error(path), '无法打开文件预览');
      return;
    }
    openPreview(resolved, 'tool-result');
  };

  return (
    <div
      className="mt-1.5 max-w-md overflow-hidden rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card shadow-sm"
      data-slot="aui_changed-files"
    >
      <div className="flex items-center gap-2 border-b border-[var(--ui-stroke-tertiary)] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {files.length} 个文件已修改
        </span>
        <button
          className="shrink-0 cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => openFileReview(files[0].path)}
          title="在预览面板查看变更 diff"
        >
          审查更改
        </button>
      </div>
      <div className="max-h-[9.375rem] overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            className="row-hover flex w-full items-center gap-2 px-3 py-1 text-left text-xs"
            onClick={() => openFileReview(file.path)}
            title={file.path}
          >
            <ContextFileIcon size={13} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.name}</span>
            <span className="shrink-0 tabular-nums text-success">+{file.added}</span>
            <span className={cn('shrink-0 tabular-nums', file.removed > 0 ? 'text-destructive' : 'text-muted-foreground/40')}>
              -{file.removed}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});

export default ChangedFilesCard;
