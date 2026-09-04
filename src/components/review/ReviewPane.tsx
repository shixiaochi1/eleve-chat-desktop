/**
 * ReviewPane — 右栏「审查」面板（🔴 2026-09-05 对齐 Hermes
 * app/right-sidebar/review/index.tsx，ELEVE tailwind token 重绘）
 *
 * 组成：header（树/列表切换 + 全部暂存 + 全部丢弃 + 刷新）→ 变更文件列表/树 →
 * 选中文件 diff（复用 DiffLines，staged 标志切 diff 源）→ ShipBar → revert 确认框
 * （复用 ui/confirm-dialog，不手搓浮层）。
 *
 * 刷新边界（对齐 Hermes 事件驱动不轮询）：
 * - 挂载 → refresh（openReview/revealReview 已触发，此处兜底手点 tab 首开）
 * - workspace tick（tool.complete/外部变更；总线自带 500ms 去抖，变化才刷）
 * - 窗口 focus
 * - 活动会话 cwd 变化 = "仓库移动"→ 先清列表+选区再刷（对齐 onReviewRepoMoved，
 *   防闪现上一个仓库的 diff；useSessionCwd 订阅）
 */
import { useEffect, useRef } from 'react';
import { RefreshCw, List, FolderTree, Plus, Minus, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import DiffLines from '@/components/DiffLines';
import DiffCount from '@/components/ui/DiffCount';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { notifyError } from '@/utils/notifications';
import { useWorkspaceTick } from '@/lib/workspace-events';
import { useSessionCwd } from '@/lib/session-cwd';
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
  const {
    files, loading, isRepo, selectedPath, diff, diffLoading, treeMode, revertTarget, shipBusy,
  } = useReview();

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const hasFiles = files.length > 0;
  const revertingAll = revertTarget?.path == null;

  // 挂载即刷（手点 tab 首开时 openReview 未经过；重复刷由 store seq 守卫幂等）
  useEffect(() => {
    void refreshReview();
  }, []);

  // workspace tick：tool.complete/外部文件变更（跳过挂载首轮——上面已刷）
  const workspaceTick = useWorkspaceTick();
  const lastTickRef = useRef(workspaceTick);
  useEffect(() => {
    if (workspaceTick !== lastTickRef.current) {
      lastTickRef.current = workspaceTick;
      void refreshReview();
    }
  }, [workspaceTick]);

  // cwd 变化 = 仓库移动（对齐 Hermes onReviewRepoMoved）：先清列表+选区再刷，
  // 面板直接落加载骨架，不闪现上一个仓库的 diff
  const sessionCwd = useSessionCwd();
  const lastCwdRef = useRef(sessionCwd);
  useEffect(() => {
    if (sessionCwd !== lastCwdRef.current) {
      lastCwdRef.current = sessionCwd;
      void refreshReview();
    }
  }, [sessionCwd]);

  // 窗口 focus：外部终端可能动过仓库
  useEffect(() => {
    const onFocus = () => void refreshReview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const errWrap = (action: string) => (err: unknown) => notifyError(err, action);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
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
            <DiffCount added={selectedFile.added} removed={selectedFile.removed} className="text-[0.64rem] leading-4" />
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
              {selectedFile.staged ? <Minus size={12} /> : <Plus size={12} />}
            </button>
            <button
              aria-label="关闭 diff"
              className={ACTION_BTN}
              title="关闭"
              onClick={clearReviewSelection}
            >
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

      {/* revert 确认（不可逆；先关框后执行，失败落 toast——对齐 Hermes ConfirmDialog 语义） */}
      <ConfirmDialog
        open={revertTarget !== undefined}
        title={revertingAll ? '丢弃全部变更？' : '丢弃该文件变更？'}
        message={
          '将丢弃未提交的改动（含已暂存），此操作不可恢复。' +
          (!revertingAll && revertTarget?.path ? `\n${revertTarget.path}` : '')
        }
        confirmLabel={revertingAll ? '全部丢弃' : '丢弃'}
        tone="danger"
        busy={shipBusy}
        onCancel={cancelRevert}
        onConfirm={() => void confirmRevert().catch((err) => notifyError(err, '丢弃变更'))}
      />
    </div>
  );
}
