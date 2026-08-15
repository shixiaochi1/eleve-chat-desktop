/**
 * DispatchModal — 手动调度任务（主看板与侧边栏看板共享）
 *
 * 从 KanbanPanel 调度模态抽取并扩展：
 * - dry_run 预览（默认开，安全）+ max_spawn 限制（空 = 读后端 config）
 * - 结果面板完整展示后端 DispatchResult：claimed / claimed_ready /
 *   spawned_count / reclaimed / stale / timed_out / promoted / crashed /
 *   rate_limited / skipped_*（含原因）/ auto_*
 * - 非 dry_run 执行成功后回调 onDispatched（包装组件刷新看板）
 */
import { useEffect, useState } from 'react';
import { X, Loader, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dispatchKanbanTasks } from '@/utils/api';

interface DispatchModalProps {
  open: boolean;
  board: string;
  onClose: () => void;
  /** 非 dry_run 执行成功后触发（刷新看板） */
  onDispatched?: () => void;
}

export function DispatchModal({ open, board, onClose, onDispatched }: DispatchModalProps) {
  // 🔴 2026-08-16 修复：dry_run 默认 false——原默认 true（预览模式）导致用户
  //   点「执行调度」实际只是预览（结果面板标注 dry_run 但任务不动），
  //   「派发功能是假的」的 UX 根因；预览改为显式勾选
  const [dryRun, setDryRun] = useState(false);
  const [maxSpawn, setMaxSpawn] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  // 每次打开重置状态
  useEffect(() => {
    if (open) { setResult(null); setBusy(false); setMaxSpawn(''); }
  }, [open]);

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const params: Record<string, any> = { board, dry_run: dryRun };
      if (maxSpawn.trim()) params.max_spawn = parseInt(maxSpawn, 10);
      const data = await dispatchKanbanTasks(params);
      setResult(data);
      if (!dryRun) onDispatched?.();
    } catch (err) {
      setResult({ error: (err as Error).message || '调度失败' });
    } finally {
      setBusy(false);
    }
  };

  const r = result?.result;
  const list = (ids?: unknown[]) => (Array.isArray(ids) && ids.length > 0 ? ids.join(', ') : '0');
  const row = (label: string, value: React.ReactNode, warn = false) => (
    <div className={cn('flex items-baseline gap-2', warn && 'text-warning')}>
      <span className="shrink-0 text-[var(--ui-text-quaternary)]">{label}</span>
      <span className="min-w-0 break-all font-mono text-[0.68rem] text-[var(--ui-text-secondary)]">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-[420px] max-w-[94vw] max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--kanban-col-border)] bg-[var(--kanban-card-bg)] shadow-xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'scaleIn 0.15s ease-out' }}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">
            <Zap size={14} strokeWidth={1.5} className="text-warning" />
            手动调度{board !== 'default' ? ` · ${board}` : ''}
          </span>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--color-accent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">最大并发数（空 = 后端 config）</label>
            <input value={maxSpawn} onChange={e => setMaxSpawn(e.target.value.replace(/\D/g, ''))} placeholder="默认不限" type="number" min="1"
              className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--kanban-col-border)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-card-selected-bar)]" />
          </div>
          <label className="flex items-center gap-2 text-[0.8rem] text-[var(--ui-text-primary)] cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
              className="rounded border-[var(--kanban-col-border)] accent-[var(--kanban-card-selected-bar)]" />
            预览模式（dry_run，不实际执行）
          </label>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose}
            className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--kanban-col-border)] text-[var(--ui-text-tertiary)] hover:bg-[var(--color-accent)] transition-colors">关闭</button>
          <button onClick={() => void run()} disabled={busy}
            className="text-[0.8rem] px-4 py-1.5 rounded-md bg-[var(--kanban-card-selected-bar)] text-[var(--color-primary-foreground)] hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
            {dryRun ? '预览调度' : '执行调度'}
          </button>
        </div>

        {result && (
          <div className={cn('rounded-md border p-3 space-y-1.5 text-[0.75rem]',
            result.error
              ? 'border-danger/20 bg-danger/5'
              : 'border-[var(--kanban-col-border)] bg-[color-mix(in_srgb,var(--ui-base)_4%,transparent)]'
          )}>
            {result.error ? (
              <span className="text-danger">{result.error}</span>
            ) : (
              <>
                <div className="font-medium text-[var(--ui-text-primary)]">{result.message || '调度完成'}</div>
                {r && (
                  <div className="space-y-1">
                    {r.claimed?.length > 0 && row('已认领', list(r.claimed))}
                    {r.claimed_ready?.length > 0 && (
                      row('待 spawn',
                        `${r.claimed_ready.length} 个（${(r.claimed_ready as Array<{ task_id?: string; assignee?: string }>).map(c => c.task_id || c.assignee).filter(Boolean).join(', ')}）`)
                    )}
                    {typeof r.spawned_count === 'number' && row('实际 spawn', String(r.spawned_count))}
                    <div className="flex flex-wrap gap-x-3 text-[var(--ui-text-tertiary)]">
                      <span>回收 {r.reclaimed ?? 0}</span>
                      <span>陈旧 {r.stale?.length ?? 0}</span>
                      <span>超时 {r.timed_out?.length ?? 0}</span>
                      <span>提升 {r.promoted ?? 0}</span>
                      <span>崩溃 {r.crashed?.length ?? 0}</span>
                      <span>限流 {r.rate_limited?.length ?? 0}</span>
                    </div>
                    {(r.skipped_unassigned?.length > 0 || r.skipped_nonspawnable?.length > 0 || r.skipped_per_profile_capped?.length > 0 || r.respawn_guarded?.length > 0 || r.auto_blocked?.length > 0 || r.auto_assigned_default?.length > 0) && (
                      <div className="space-y-0.5 text-[var(--ui-text-tertiary)]">
                        {r.skipped_unassigned?.length > 0 && row('未分配跳过', list(r.skipped_unassigned))}
                        {r.skipped_nonspawnable?.length > 0 && row('不可调度', list(r.skipped_nonspawnable))}
                        {r.skipped_per_profile_capped?.length > 0 && row('并发上限跳过', `${r.skipped_per_profile_capped.length} 个`)}
                        {r.respawn_guarded?.length > 0 && row('重生保护', list(r.respawn_guarded.map((g: any) => g?.task_id || g)))}
                        {r.auto_blocked?.length > 0 && row('自动阻塞', list(r.auto_blocked))}
                        {r.auto_assigned_default?.length > 0 && row('自动分配 default', list(r.auto_assigned_default))}
                      </div>
                    )}
                    {r.dry_run && <div className="text-warning italic pt-0.5">* 预览模式，未实际执行</div>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
