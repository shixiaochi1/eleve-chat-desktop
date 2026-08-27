/**
 * PreviewStatusStrip — 输入框上方的可预览目标状态行（🔴 2026-08-28 对齐 Hermes
 * composer status-stack/preview-row.tsx）
 *
 * 交互语义（对齐 Hermes preview-row）：
 * - 普通点击 = 系统浏览器打开（openDefaultTarget）
 * - ⌘/Ctrl + 点击 = toggle 应用内预览（已开 → closePreviewForSource；未开 →
 *   openPreview(tool-result)，cwd 用检测时捕获值）
 * - trailing dismiss = 从 feed 移除（不关预览 tab）
 */

import { ExternalLink, Globe, X } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { closePreviewForSource, openPreview } from '@/store/preview';
import {
  removePreviewArtifact,
  usePreviewArtifacts,
  type PreviewArtifact,
} from '@/store/preview-status';

function StatusRow({ item, onDismiss }: { item: PreviewArtifact; onDismiss: (id: string) => void }) {
  const resolveTarget = () => normalizeOrLocalPreviewTarget(item.target, item.cwd || undefined);

  const openDefaultTarget = () => {
    const target = resolveTarget();
    if (target) openPreview(target, 'tool-result');
  };

  const toggleInAppPreview = () => {
    const target = resolveTarget();
    if (!target) return;
    closePreviewForSource(item.target) || openPreview(target, 'tool-result');
  };

  return (
    <div
      className="group/status-row flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)] px-2 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) toggleInAppPreview();
        else openDefaultTarget();
      }}
      title={`${item.target}（⌘/Ctrl+点击在应用内预览中开/关）`}
    >
      <Globe size={12} className="shrink-0 text-info" />
      <span className="min-w-0 flex-1 truncate text-[var(--ui-text-secondary)]">{item.label}</span>
      <ExternalLink
        size={11}
        className="shrink-0 text-[var(--ui-text-quaternary)] opacity-0 group-hover/status-row:opacity-100"
      />
      <button
        type="button"
        aria-label="移除"
        className="-my-1 grid size-4 shrink-0 place-items-center rounded-md text-muted-foreground/60 hover:text-foreground/90"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(item.id);
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

/** 单视图输入框上方状态行（sessionId = 当前会话；空 feed 渲染 null） */
export default function PreviewStatusStrip({ sessionId }: { sessionId?: string | null }) {
  const items = usePreviewArtifacts(sessionId ?? '');
  const sorted = useMemo(() => items, [items]);
  if (!sessionId || sorted.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-1 px-3 pt-1.5')}>
      {sorted.map((item) => (
        <StatusRow key={item.id} item={item} onDismiss={(id) => removePreviewArtifact(sessionId, id)} />
      ))}
    </div>
  );
}
