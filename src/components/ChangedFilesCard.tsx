import { memo, useMemo } from 'react';
import { ContextFileIcon } from './Icons';
import DiffCount from '@/components/ui/DiffCount';
import { deriveChangedFiles } from '@/lib/changed-files';
import { openReviewForPath, revealReview } from '@/store/review';
import type { ChatMessagePart } from '@/lib/chat-messages';

/**
 * Cursor 风格「N 个文件已修改」汇总卡片（对齐 Hermes ChangedFilesCard）：
 * 每行一个本轮编辑过的文件 + 该文件 +a/-b，收尾最新一轮 assistant 消息。
 * 仅最后一条已落定的 assistant 消息渲染（门控在 MessageRow isLast）。
 *
 * 🔴 2026-09-05 审查域接入（对齐 Hermes changed-files-card.tsx 交互语义）：
 * - 文件行可点 → 审查面板定位该文件 diff（对齐 openReviewForPath）；
 * - 头部「审查更改」→ 打开审查面板（对齐 revealReview）。
 * （早前"最小档直开预览面板"被本审查域取代——Review 面板同样以
 *   files_diff 数据渲染 diff，且补齐 stage/unstage/revert/commit 处置。）
 */
const ChangedFilesCard = memo(function ChangedFilesCard({ parts }: { parts: readonly ChatMessagePart[] }) {
  const files = useMemo(() => deriveChangedFiles(parts), [parts]);

  if (files.length === 0) {
    return null;
  }

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
          onClick={() => revealReview()}
          title="打开审查面板"
        >
          审查更改
        </button>
      </div>
      <div className="max-h-[9.375rem] overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            className="row-hover flex w-full items-center gap-2 px-3 py-1 text-left text-xs"
            onClick={() => void openReviewForPath(file.path)}
            title={file.path}
          >
            <ContextFileIcon size={13} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.name}</span>
            <DiffCount added={file.added} removed={file.removed} showZero className="text-xs" />
          </button>
        ))}
      </div>
    </div>
  );
});

export default ChangedFilesCard;
