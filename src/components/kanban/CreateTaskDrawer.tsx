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
import { X, Loader, Gauge } from 'lucide-react';
import { COLUMNS } from './constants';
import { estimateKanbanTask } from '../../utils/api';

const WORKSPACE_KINDS = [
  { key: 'scratch', label: 'scratch（沙箱，默认）' },
  { key: 'worktree', label: 'worktree（Git 工作树）' },
  { key: 'dir', label: 'dir（指定目录）' },
];

/** 🔴 P0-4 估算结果（对齐 Hermes estimateNew footer 展示） */
interface EstimateResult {
  estTokens: number;
  complexity: string;
  rationale: string;
}

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
  /** 负责人下拉选项（profiles roster，对齐 Hermes fetchProfiles） */
  assigneeOptions: Array<{ name: string }>;
  /** 🔴 对齐 Hermes k.defaultOption(resolvedDefault)（board.tsx L741-748，审查
   *   d3-18）：实际解析出的默认负责人——默认项显示真实值、roster 排除去重 */
  defaultAssignee?: string;
  /** 🔴 对齐 Hermes ModelCatalogMenu 数据源（审查 d3-2/d2-14）：profiles 的
   *  model/provider 去重目录，配合 datalist 下拉+手输 */
  modelOptions: string[];
  providerOptions: string[];
  /** 🔴 看板默认工作区/目录（审查 d3-20/d3-14）：kind 下拉标注「(看板默认)」+
   *   路径继承提示行（对齐 Hermes board default 后缀/workspaceInheritDir） */
  boardDefaultKind?: string;
  boardDefaultDir?: string;
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
  providerOverride, reasoningEffort, assigneeOptions, modelOptions, providerOptions,
  boardDefaultKind, boardDefaultDir, defaultAssignee,
  parentOptions,
  onTitleChange, onBodyChange, onAssigneeChange, onPriorityChange, onSkillsChange, onParentChange,
  onGoalModeChange, onGoalMaxTurnsChange, onWorkspaceKindChange, onWorkspacePathChange, onModelOverrideChange,
  onProviderOverrideChange, onReasoningEffortChange,
  onSubmit, onClose,
}: CreateTaskDrawerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔴 P0-4：工作量估算状态（对齐 Hermes estimateNew：footer 展示 + 重估）
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  // 每次打开重置内部状态（组件常驻，open 切换不卸载）
  useEffect(() => {
    if (open) { setError(null); setSubmitting(false); setEstimate(null); }
  }, [open]);
  // 🔴 修复（渲染错误根因）：标题变更后旧估算失效——此 useEffect 原先写在
  //   `if (!open) return null` 之后，open=false 时执行 6 个 hooks、open=true 时
  //   执行 7 个，React 报 "Rendered more hooks than during the previous render"。
  //   已移到 early return 之前（hook 数量恒定）
  useEffect(() => {
    if (open) setEstimate(null);
  }, [open, title]);
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

  // 🔴 P0-4：工作量估算（对齐 Hermes estimateNew——辅助模型估 token+复杂度，
  //   footer 展示 ~N tok · L/M/S + 重估；永不抛错，失败内联提示）
  const runEstimate = async () => {
    if (!title.trim() || estimating) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await estimateKanbanTask(title.trim(), body);
      if (res?.ok) {
        setEstimate({
          estTokens: Number(res.est_tokens ?? 0),
          complexity: res.complexity ?? 'M',
          rationale: res.rationale ?? '',
        });
      } else {
        setEstimate(null);
        setEstimateError(res?.reason ?? '估算失败');
      }
    } catch (err) {
      setEstimate(null);
      setEstimateError(err instanceof Error ? err.message : String(err));
    } finally {
      setEstimating(false);
    }
  };

  const form = (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
      {/* 🔴 P0-4 估算行（对齐 Hermes footer 展示） */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => void runEstimate()} disabled={!title.trim() || estimating}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--color-border)] text-[0.75rem] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {estimating ? <Loader size={12} strokeWidth={1.5} className="animate-spin" /> : <Gauge size={12} strokeWidth={1.5} />}
          {estimating ? '估算中...' : '估算'}
        </button>
        {estimate && (
          <span className="text-[0.75rem] text-[var(--color-muted-foreground)]">
            ~{estimate.estTokens.toLocaleString()} tok · <span className="font-medium">{estimate.complexity}</span>
            {estimate.rationale && <span className="text-[var(--color-muted-foreground)]/70"> — {estimate.rationale}</span>}
          </span>
        )}
        {estimateError && <span className="text-[0.7rem] text-danger">{estimateError}</span>}
      </div>
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
          {/* 🔴 对齐 Hermes NewTaskDialog：负责人从自由文本改为 roster 下拉
              （默认继承 + 各 profile + 显式停放 PARKED）——自由文本错名会
              静默成死卡（dispatcher 不认），且无法显式创建未分配任务 */}
          <select value={assignee} onChange={e => onAssigneeChange(e.target.value)}
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]">
            <option value="">{defaultAssignee ? `默认（${defaultAssignee}）` : '默认（继承看板 default_assignee）'}</option>
            {assigneeOptions.filter(p => p.name !== defaultAssignee).map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
            <option value="__parked__">停放（不分配，不会自动运行）</option>
          </select>
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
      {/* 工作区类型（对齐 HERMES NewTaskDialog：'' = 继承看板 default_workspace_kind；
          后端 create_task 校验 kind 并兜底）
          🔴 对齐 Hermes board default 后缀（board.tsx L711-716，审查 d3-20）：
          当前看板默认 kind 在下拉对应项标注「(看板默认)」 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">工作区类型</label>
        <select value={workspaceKind} onChange={e => onWorkspaceKindChange(e.target.value)}
          className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]">
          <option value="">默认{boardDefaultKind ? `（看板默认: ${boardDefaultKind}）` : '（继承看板配置）'}</option>
          {WORKSPACE_KINDS.map(w => (
            <option key={w.key} value={w.key}>
              {w.label}{boardDefaultKind === w.key ? '（看板默认）' : ''}
            </option>
          ))}
        </select>
        {workspaceKind && workspaceKind !== 'scratch' && (
          <>
            <input value={workspacePath} onChange={e => onWorkspacePathChange(e.target.value)}
              placeholder="工作区路径（留空继承看板默认目录）"
              className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
            {/* 🔴 对齐 Hermes 继承提示行（board.tsx L722-733，审查 d3-14）：
                显示看板实际默认目录值 */}
            {!workspacePath.trim() && boardDefaultDir && (
              <span className="text-[0.65rem] text-[var(--color-muted-foreground)]">
                留空继承看板默认目录：<code className="font-mono">{boardDefaultDir}</code>
              </span>
            )}
          </>
        )}
      </div>
      {/* 模型覆盖（对齐 HERMES TaskModelOverride 三元组：model + provider +
          reasoning effort；全留空继承 profile 模型）
          🔴 对齐 Hermes ModelCatalogMenu（审查 d3-2/d2-14）：模型/provider
          从 profiles 目录去重下拉（可手输）+ 推理深度白名单下拉——此前裸
          文本框易拼错模型 id 静默进任务 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">模型覆盖（可选）</label>
        <input value={modelOverride} onChange={e => onModelOverrideChange(e.target.value)} list="eleve-kanban-model-catalog"
          placeholder="留空继承 assigned profile 的模型"
          className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
        <datalist id="eleve-kanban-model-catalog">
          {modelOptions.map(m => <option key={m} value={m} />)}
        </datalist>
        <div className="grid grid-cols-2 gap-2">
          <input value={providerOverride} onChange={e => onProviderOverrideChange(e.target.value)} list="eleve-kanban-provider-catalog"
            placeholder="Provider（如 openrouter）"
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
          <datalist id="eleve-kanban-provider-catalog">
            {providerOptions.map(p => <option key={p} value={p} />)}
          </datalist>
          <select value={reasoningEffort} onChange={e => onReasoningEffortChange(e.target.value)}
            className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)] cursor-pointer">
            <option value="">推理深度（继承）</option>
            {['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
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
