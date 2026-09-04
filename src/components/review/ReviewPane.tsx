/**
 * ReviewPane — 右栏「审查」面板（🔴 2026-09-05 对齐 Hermes
 * app/right-sidebar/review/index.tsx，ELEVE tailwind token 重绘）
 *
 * 组成：header（树/列表切换 + 全部暂存 + 全部丢弃 + 刷新）→ 变更文件列表/树 →
 * 选中文件 diff（复用 DiffLines，staged 标志切 diff 源）→ ShipBar → revert 确认框。
 * 刷新边界（workspace tick / 变更操作后 / focus / 打开）接线在 store + 本组件 effect。
 */
import { useEffect } from 'react';
import { RefreshCw, List, FolderTree, Plus, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import DiffLines from '@/components/DiffLines';
import { notifyError } from '@/utils/notifications';
import { useWorkspaceTick } from '@/lib/workspace-events';
import {
  cancelRevert,
  clearReviewSelection,
  confirmRevert,
  refreshReview,
  requestRevert,
  stageReviewFile,
  toggleTreeMode,
  unstageReviewFile,
  useReview,
} from '@/store/review';
import ReviewFileTree from './ReviewFileTree';
import ReviewShipBar from './ReviewShipBar';

const ACTION_BTN =
  'grid size-5 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-40';

export default function ReviewPane() {
  const review = useReview();
  const {
    files, loading, isRepo, selectedPath, diff, diffLoading, treeMode, revertTarget, shipBusy,
  } = review;

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const hasFiles = files.length > 0;
  const revertingAll = revertTarget?.path == null;

  // 刷新边界：workspace tick（tool.complete/外部变更，500ms 去抖）+ 窗口 focus。
  // 打开时的首次加载由 openReview()/revealReview() 驱动（对齐 Hermes 事件驱动不轮询）。
  const workspaceTick = useWorkspaceTick();
  useEffect(() => {
    if (workspaceTick > 0) void refreshReview();
  }, [workspaceTick]);

  useEffect(() => {
    const onFocus = () => void refreshReview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const errWrap = (action: string) => (err: unknown) => notifyError(err, action);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--ui-stroke-tertiary)] px-2.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          审查
          {hasFiles && (
            <span className="ml-1.5 tabular-nums text-muted-foreground/60">{files.length}</span>
          )}
        </span>
        <button
          aria-label={treeMode === 'tree' ? '切换为列表' : '切换为树'}
          className={ACTION_BTN}
          disabled={!hasFiles}
          title={treeMode === 'tree' ? '列表视图' : '树视图'}
          onClick={toggleTreeMode}
        >
          {treeMode === 'tree' ? <List size={13} /> : <FolderTree size={13} />}
        </button>
        <button
          aria-label="全部暂存"
          className={ACTION_BTN}
          disabled={!hasFiles}
          title="全部暂存"
          onClick={() => void stageReviewFile(null).catch(errWrap('全部暂存'))}
        >
          <Plus size={13} />
        </button>
        <button
          aria-label="全部丢弃"
          className={ACTION_BTN}
          disabled={!hasFiles}
          title="全部丢弃"
          onClick={() => requestRevert(null)}
        >
          <RotateCcw size={13} />
        </button>
        <button
          aria-label="刷新"
          className={ACTION_BTN}
          title="刷新"
          onClick={() => void refreshReview()}
        >
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      {/* 变更列表 / 空态 */}
      {!isRepo && !loading ? (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
          当前会话目录不是 git 仓库
        </div>
      ) : hasFiles ? (
        <ReviewFileTree />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
          {loading ? '加载中…' : '没有变更'}
        </div>
      )}

      {/* 选中文件 diff */}
      {selectedFile && (
        <div className="flex max-h-[55%] shrink-0 flex-col border-t border-[var(--ui-stroke-tertiary)]">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[0.66rem] text-muted-foreground"
              title={selectedFile.path}
            >
              {selectedFile.path}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-[0.64rem] tabular-nums">
              {selectedFile.added > 0 && <span className="text-success">+{selectedFile.added}</span>}
              {selectedFile.removed > 0 && <span className="text-destructive">−{selectedFile.removed}</span>}
            </span>
            <button
              aria-label={selectedFile.staged ? '取消暂存' : '暂存'}
              className={ACTION_BTN}
              title={selectedFile.staged ? '取消暂存' : '暂存'}
              onClick={() =>
                void (selectedFile.staged
                  ? unstageReviewFile(selectedFile.path)
                  : stageReviewFile(selectedFile.path)
                ).catch(errWrap('暂存'))
              }
            >
              {selectedFile.staged ? <RotateCcw size={12} /> : <Plus size={12} />}
            </button>
            <button aria-label="关闭 diff" className={ACTION_BTN} title="关闭" onClick={clearReviewSelection}>
              <X size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {diffLoading ? (
              <div className="py-6 text-center text-[0.66rem] text-muted-foreground/60">加载 diff…</div>
            ) : diff ? (
              <DiffLines text={diff} showLineNumbers maxHeight="none" />
            ) : (
              <div className="py-6 text-center text-[0.66rem] text-muted-foreground/60">无差异</div>
            )}
          </div>
        </div>
      )}

      <ReviewShipBar />

      {/* revert 确认（不可逆，对齐 Hermes ConfirmDialog 语义：先关框后执行，失败 toast） */}
      {revertTarget !== undefined && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/40" onClick={cancelRevert}>
          <div
            className="w-72 rounded-xl border border-[var(--ui-stroke-secondary)] bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium text-foreground">{revertingAll ? '丢弃全部变更？' : '丢弃该文件变更？'}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              将丢弃未提交的改动（含已暂存），此操作不可恢复。
              {!revertingAll && revertTarget.path && (
                <span className="mt-1 block truncate font-mono text-[0.66rem]" title={revertTarget.path}>
                  {revertTarget.path}
                </span>
              )}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded border border-[var(--ui-stroke-tertiary)] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                onClick={cancelRevert}
              >
                取消
              </button>
              <button
                className="rounded bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                disabled={shipBusy}
                onClick={() => {
                  void confirmRevert().catch((err) => notifyError(err, '丢弃变更'));
                }}
              >
                {revertingAll ? '全部丢弃' : '丢弃'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
