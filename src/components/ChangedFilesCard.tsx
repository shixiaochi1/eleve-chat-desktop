import { memo, useMemo } from 'react';
import { ContextFileIcon } from './Icons';
import { cn } from '@/lib/utils';
import { deriveChangedFiles } from '@/lib/changed-files';
import type { ChatMessagePart } from '@/lib/chat-messages';

/**
 * Cursor 风格「N 个文件已修改」汇总卡片（对齐 Hermes ChangedFilesCard）：
 * 每行一个本轮编辑过的文件 + 该文件 +a/-b，收尾最新一轮 assistant 消息。
 * 仅最后一条已落定的 assistant 消息渲染（门控在 MessageRow isLast）。
 */
const ChangedFilesCard = memo(function ChangedFilesCard({ parts }: { parts: readonly ChatMessagePart[] }) {
  const files = useMemo(() => deriveChangedFiles(parts), [parts]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-1.5 max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-slot="aui_changed-files"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {files.length} 个文件已修改
        </span>
      </div>
      <div className="max-h-[9.375rem] overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.path}
            className="row-hover flex items-center gap-2 px-3 py-1 text-xs"
            title={file.path}
          >
            <ContextFileIcon size={13} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.name}</span>
            <span className="shrink-0 tabular-nums text-success">+{file.added}</span>
            <span className={cn('shrink-0 tabular-nums', file.removed > 0 ? 'text-destructive' : 'text-muted-foreground/40')}>
              -{file.removed}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default ChangedFilesCard;
