/**
 * CreateTaskDrawer — 新建任务抽屉（主看板与侧边栏看板共享）
 *
 * 从 KanbanPanel 创建抽屉抽取并扩展（对齐 HERMES NewTaskDialog 字段集）：
 * - 全量字段：标题/详细描述/负责人（triage 显 Specifier）/优先级 P0-P3/
 *   Skills/工作区类型（scratch/worktree/dir + 可选路径覆盖）/Goal Mode（最大轮次）/
 *   父任务下拉
 * - variant: 'drawer'（主看板，右侧滑出）/ 'overlay'（侧边栏容器内覆盖层）
 * - 提交走包装组件的 onSubmit（= useKanban.handleCreateSubmit，失败 reject →
 *   本组件展示错误）；创建成功由 useKanban 侧完成落列 + auto-nudge + 刷新
 */
import { useEffect, useState } from 'react';
import { X, Loader } from 'lucide-react';
import { COLUMNS } from './constants';

const WORKSPACE_KINDS = [
  { key: 'scratch', label: 'scratch（沙箱，默认）' },
  { key: 'worktree', label: 'worktree（Git 工作树）' },
  { key: 'dir', label: 'dir（指定目录）' },
];

interface CreateTaskDrawerProps {
  open: boolean;
  /** 目标列 key（creatingIn） */
  target: string;
  variant?: 'drawer' | 'overlay';
  title: string;
  body: string;
  assignee: string;
  priority: string;
  skills: string;
  parent: string;
  goalMode: boolean;
  goalMaxTurns: string;
  workspaceKind: string;
  workspacePath: string;
  modelOverride: string;
  /** 对齐 Hermes 三元组：provider 覆盖（须与 model 成对） */
  providerOverride: string;
  /** 对齐 Hermes 三元组：推理深度覆盖（none/minimal/low/medium/high/xhigh） */
  reasoningEffort: string;
  parentOptions: Array<{ id: string; title: string }>;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onAssigneeChange: (v: string) => void;
  onPriorityChange: (v: string) => void;
  onSkillsChange: (v: string) => void;
  onParentChange: (v: string) => void;
  onGoalModeChange: (v: boolean) => void;
  onGoalMaxTurnsChange: (v: string) => void;
  onWorkspaceKindChange: (v: string) => void;
  onWorkspacePathChange: (v: string) => void;
  onModelOverrideChange: (v: string) => void;
  onProviderOverrideChange: (v: string) => void;
  onReasoningEffortChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}

export function CreateTaskDrawer({
  open, target, variant = 'drawer',
  title, body, assignee, priority, skills, parent, goalMode, goalMaxTurns, workspaceKind, workspacePath, modelOverride,
  providerOverride, reasoningEffort,
  parentOptions,
  onTitleChange, onBodyChange, onAssigneeChange, onPriorityChange, onSkillsChange, onParentChange,
  onGoalModeChange, onGoalMaxTurnsChange, onWorkspaceKindChange, onWorkspacePathChange, onModelOverrideChange,
  onProviderOverrideChange, onReasoningEffortChange,
  onSubmit, onClose,
}: CreateTaskDrawerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 每次打开重置内部状态（组件常驻，open 切换不卸载）
  useEffect(() => {
    if (open) { setError(null); setSubmitting(false); }
  }, [open]);
  if (!open) return null;

  const isTriage = target === 'triage';
  const targetLabel = COLUMNS.find(c => c.key === target)?.label || target;

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const doClose = () => { if (!submitting) onClose(); };

  const form = (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
      {/* 标题 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">标题 *</label>
        <textarea autoFocus value={title} onChange={e => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
            if (e.key === 'Escape') doClose();
          }}
          placeholder={isTriage ? '粗略想法 — AI 将细化...' : '任务标题'}
          rows={2}
          className="w-full text-[0.85rem] px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)] min-h-[3rem]" />
      </div>
      {/* 描述 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">详细描述</label>
        <textarea value={body} onChange={e => onBodyChange(e.target.value)}
          placeholder="描述任务的目标、范围、验收标准..."
          rows={4}
          className="w-full text-[0.85rem] px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)]" />
      </div>
      {/* 负责人 + 优先级 */}
      <div className="flex gap-4">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">{isTriage ? 'Specifier' : 'Assignee'}</label>
          <input value={assignee} onChange={e => onAssigneeChange(e.target.value)} placeholder="留空自动分配"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        </div>
        <div className="w-24 flex flex-col gap-1.5">
          <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">优先级</label>
          <input type="number" value={priority} onChange={e => onPriorityChange(e.target.value)} placeholder="0"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        </div>
      </div>
      {/* Skills */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">Skills</label>
        <input value={skills} onChange={e => onSkillsChange(e.target.value)} placeholder="逗号分隔，如 rust, python, devops"
          className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
      </div>
      {/* 工作区类型（对齐 HERMES NewTaskDialog；后端 create_task 校验 kind） */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">工作区类型</label>
        <select value={workspaceKind} onChange={e => onWorkspaceKindChange(e.target.value)}
          className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]">
          {WORKSPACE_KINDS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
        {workspaceKind !== 'scratch' && (
          <input value={workspacePath} onChange={e => onWorkspacePathChange(e.target.value)}
            placeholder="工作区路径（留空继承看板默认目录）"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        )}
      </div>
      {/* 模型覆盖（对齐 HERMES TaskModelOverride 三元组：model + provider +
          reasoning effort；全留空继承 profile 模型） */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">模型覆盖（可选）</label>
        <input value={modelOverride} onChange={e => onModelOverrideChange(e.target.value)}
          placeholder="留空继承 assigned profile 的模型"
          className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        <div className="grid grid-cols-2 gap-2">
          <input value={providerOverride} onChange={e => onProviderOverrideChange(e.target.value)}
            placeholder="Provider（如 openrouter）"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
          <input value={reasoningEffort} onChange={e => onReasoningEffortChange(e.target.value)}
            placeholder="推理深度（如 high）"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        </div>
        <span className="text-[0.65rem] text-[var(--color-muted-foreground)]">Provider 需配合模型填写；推理深度取值 none/minimal/low/medium/high/xhigh</span>
      </div>
      {/* Goal Mode */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[0.85rem] text-[var(--color-foreground)] cursor-pointer">
          <input type="checkbox" checked={goalMode} onChange={e => onGoalModeChange(e.target.checked)} className="rounded border-[var(--color-border)] w-4 h-4" />
          Goal Mode（循环执行直到判定完成）
        </label>
        {goalMode && (
          <div className="flex items-center gap-2 ml-6">
            <span className="text-[0.75rem] text-[var(--color-muted-foreground)]">最大轮次</span>
            <input type="number" value={goalMaxTurns} onChange={e => onGoalMaxTurnsChange(e.target.value)}
              className="w-20 text-[0.85rem] h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)] text-center" />
          </div>
        )}
      </div>
      {/* 父任务 */}
      {parentOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">父任务</label>
          <select value={parent} onChange={e => onParentChange(e.target.value)}
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]">
            <option value="">无</option>
            {parentOptions.map(t => (
              <option key={t.id} value={t.id}>{t.title?.slice(0, 40) || t.id}</option>
            ))}
          </select>
        </div>
      )}
      {error && <div className="text-[0.75rem] text-danger px-1">创建失败: {error}</div>}
    </div>
  );

  const footer = (
    <div className="shrink-0 border-t border-[var(--color-border)] flex gap-3 px-5 py-4">
      <button onClick={() => void submit()} disabled={!title.trim() || submitting}
        className="flex-1 h-10 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[0.85rem] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
        {submitting && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
        {submitting ? '创建中...' : '创建任务'}
      </button>
      <button onClick={doClose}
        className="h-10 px-4 rounded-md border border-[var(--color-border)] text-[0.85rem] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
        取消
      </button>
    </div>
  );

  const header = (
    <div className="flex items-center justify-between shrink-0 border-b border-[var(--color-border)] px-5 py-4">
      <h3 className="text-[0.95rem] font-semibold text-[var(--color-foreground)]">新建任务 → {targetLabel}</h3>
      <button onClick={doClose} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
        <X size={18} strokeWidth={1.5} />
      </button>
    </div>
  );

  if (variant === 'overlay') {
    // 侧边栏：容器内覆盖层（绝对定位），表单区滚动
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--ui-bg-elevated)] border border-[var(--ui-stroke-tertiary)] rounded-lg overflow-hidden">
        {header}
        {form}
        {footer}
      </div>
    );
  }

  // 主看板：右侧滑出抽屉
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay/40" onClick={doClose} style={{ animation: 'fadeIn 150ms ease-out' }}>
      <div className="fixed inset-y-0 right-0 w-[420px] max-w-full z-50 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
        {header}
        {form}
        {footer}
      </div>
    </div>
  );
}
