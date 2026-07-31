/**
 * QueuePanel — 排队消息面板（对齐 Hermes queue-panel.tsx）
 *
 * 纯渲染组件：序号 + 截断预览 + 附件数 + ✏️编辑 / ⬆️立即发送 / 🗑删除
 * - 空队列不渲染（return null）
 * - editingId 高亮 + 其他条目编辑按钮禁用（对齐 Hermes editingId 互斥）
 * - busy 时"立即发送"语义 = 置首 + abort（tooltip 区分）
 *
 * 单视图：InputArea 上方渲染
 * 宫格：每卡 AgentCardComposer 上方渲染
 */
import { Layers, Pencil, ArrowUp, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueuedMessage } from '@/lib/message-queue';

interface QueuePanelProps {
  entries: QueuedMessage[];
  busy: boolean;
  editingId: string | null;
  onDelete: (id: string) => void;
  onEdit: (entry: QueuedMessage) => void;
  onSendNow: (id: string) => void;
}

function entryPreview(entry: QueuedMessage): string {
  const text = entry.text.trim();
  if (text) return text;
  if (entry.attachments.length > 0) return '[附件]';
  return '[空消息]';
}

export default function QueuePanel({ entries, busy, editingId, onDelete, onEdit, onSendNow }: QueuePanelProps) {
  if (entries.length === 0) return null;

  return (
    <div className="mx-3 mb-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
      {/* 标题行（对齐 Hermes StatusSection: layers 图标 + "已排队(N)"） */}
      <div className="flex items-center gap-1.5 mb-1">
        <Layers size={12} className="text-muted-foreground/70 shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground/80">已排队 ({entries.length})</span>
      </div>

      {/* 条目列表 */}
      <div className="flex flex-col gap-0.5">
        {entries.map((entry, index) => {
          const isEditing = editingId === entry.id;
          const attachCount = entry.attachments.length;

          return (
            <div
              key={entry.id}
              className={cn(
                'group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors',
                'border border-transparent',
                isEditing && 'border-primary/40 bg-accent/25',
              )}
            >
              {/* 序号 */}
              <span className="shrink-0 w-4 text-right text-[10px] tabular-nums text-muted-foreground/50">
                {index + 1}
              </span>

              {/* 预览 + 附件数 */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] leading-4 text-foreground/90">{entryPreview(entry)}</p>
                {(attachCount > 0 || isEditing) && (
                  <div className="mt-px flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    {attachCount > 0 && <span>📎 {attachCount}</span>}
                    {isEditing && <span className="text-primary/70">正在编辑…</span>}
                  </div>
                )}
              </div>

              {/* 操作按钮（对齐 Hermes: 编辑/发送/删除，hover 显示 + 编辑中常驻） */}
              <div className={cn(
                'flex shrink-0 items-center gap-0.5 transition-opacity',
                isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}>
                {/* ✏️ 编辑 */}
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="编辑排队消息"
                  aria-label="编辑排队消息"
                  disabled={Boolean(editingId) && !isEditing}
                  onClick={() => onEdit(entry)}
                >
                  <Pencil size={11} />
                </button>

                {/* ⬆️ 立即发送 */}
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title={busy ? '置首并中断当前轮（轮末自动发送）' : '立即发送'}
                  aria-label={busy ? '置首并中断' : '立即发送'}
                  disabled={isEditing}
                  onClick={() => onSendNow(entry.id)}
                >
                  <ArrowUp size={11} />
                </button>

                {/* 🗑 删除 */}
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive transition-colors"
                  title="删除排队消息"
                  aria-label="删除排队消息"
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
