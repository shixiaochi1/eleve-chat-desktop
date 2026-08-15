/**
 * CreateBoardModal — 新建看板模态（从 KanbanPanel Phase A1 抽取为共享组件）
 *
 * 🔴 修复：侧边栏看板（KanbanPanelForSidebar）此前 setShowCreateBoard(true)
 * 后无任何弹窗呈现（死交互），主面板与侧边栏各持一份重复 JSX——统一收敛到此
 * 组件，两端复用同一实现。
 */
import { X, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateBoardModalProps {
  open: boolean;
  name: string;
  desc: string;
  color: string;
  busy: boolean;
  onClose: () => void;
  onCreate: () => void;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
  onColorChange: (v: string) => void;
}

export function CreateBoardModal({ open, name, desc, color, busy, onClose, onCreate, onNameChange, onDescChange, onColorChange }: CreateBoardModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-[360px] rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'scaleIn 0.15s ease-out' }}>
        <div className="flex items-center justify-between">
          <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">新建看板</span>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">名称 *</label>
            <input value={name} onChange={e => onNameChange(e.target.value)} placeholder="例如：设计冲刺" autoFocus
              className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
            <p className="mt-1 text-[0.7rem] text-[var(--ui-text-tertiary)]">slug 将自动生成</p>
          </div>
          <div>
            <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">描述</label>
            <input value={desc} onChange={e => onDescChange(e.target.value)} placeholder="可选"
              className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
          </div>
          <div>
            <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">颜色</label>
            <div className="flex items-center gap-2">
              <input value={color} onChange={e => onColorChange(e.target.value)} placeholder="#6490C8"
                className="flex-1 text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
              {color && <span className="w-5 h-5 rounded-full border border-[var(--ui-stroke-tertiary)]" style={{ backgroundColor: color }} />}
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} disabled={busy}
            className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
          <button onClick={onCreate} disabled={busy || !name.trim()}
            className={cn('text-[0.8rem] px-4 py-1.5 rounded-md border transition-colors flex items-center gap-1.5',
              name.trim() && !busy
                ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]'
                : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed'
            )}>
            {busy && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
            创建并切换
          </button>
        </div>
      </div>
    </div>
  );
}
