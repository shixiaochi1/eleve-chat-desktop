import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextFileIcon, WebWindowIcon, ImageIcon, CopyIcon, CheckIcon, DeleteIcon } from './Icons';
import { cn } from '@/lib/utils';
import type { ArtifactDetection } from '@/lib/artifact-detect';
import {
  useArtifacts,
  useOpenArtifact,
  upsertArtifact,
  openArtifact,
  closeArtifact,
  selectArtifactVersion,
  findArtifactVersion,
} from '@/store/artifacts';
import { renderMarkdown } from '@/utils/markdown';

interface ArtifactCardProps {
  detection: ArtifactDetection;
  code: string;
  /** 围栏仍在流式增长（对齐 Hermes：shimmer + 行数，不注册版本） */
  streaming?: boolean;
  /** 会话 ID（版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null;
}

const KIND_ICON = {
  code: ContextFileIcon,
  html: WebWindowIcon,
  svg: ImageIcon,
} as const;

const KIND_LABEL = {
  code: '代码',
  html: 'HTML',
  svg: 'SVG',
} as const;

/**
 * 消息内联 artifact 卡片（对齐 Hermes ArtifactCard）：
 * 图标 + 标题 + 类型标签 + 版本徽章；流式中 shimmer + 行数占位。
 * 注册是自动的（完成时版本化），打开浮层严格点击驱动。
 */
export const ArtifactCard = memo(function ArtifactCard({ detection, code, streaming = false, sessionId = null }: ArtifactCardProps) {
  const registry = useArtifacts();
  const trimmed = code.trim();

  // 围栏完成后注册/版本化（内容哈希去重 → 重渲染/回放 no-op）
  useEffect(() => {
    if (!streaming && trimmed && sessionId) {
      upsertArtifact(sessionId, detection, trimmed);
    }
    // detection 由 code 派生，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, trimmed, sessionId]);

  // 🔴 查找对齐 Hermes：按 kind + 内容匹配版本（非 slug 匹配）——
  // 流式期间 title 可能变化（html <title> 后期才到）→ slug 随之漂移，
  // 按 slug 找不到已注册的 record（版本数恒显 1）。内容匹配不受影响。
  const record = useMemo(() => {
    void registry;
    if (!sessionId) return null;
    return (
      (registry[sessionId] ?? []).find(
        (r) => r.kind === detection.kind && r.versions.some((v) => v.content === trimmed),
      ) ?? null
    );
  }, [registry, sessionId, detection.kind, trimmed]);

  const lineCount = useMemo(() => trimmed.split('\n').length, [trimmed]);
  const versionCount = record?.versions.length ?? 0;
  const title = (record?.title || detection.title || KIND_LABEL[detection.kind]).trim() || KIND_LABEL[detection.kind];
  const Icon = KIND_ICON[detection.kind];

  const open = useCallback(() => {
    if (streaming || !trimmed || !sessionId) return;
    const result = upsertArtifact(sessionId, detection, trimmed);
    if (!result) return;
    // 点击这张卡片打开的是"这一版"（对齐 Hermes：非静默跳到最新版）
    const versionIndex = result.record.versions.findIndex((v) => v.content === trimmed);
    openArtifact(result.artifactId, versionIndex === -1 ? undefined : versionIndex);
  }, [detection, streaming, trimmed, sessionId]);

  return (
    <button
      type="button"
      disabled={streaming}
      onClick={open}
      className={cn(
        'group/artifact my-1.5 flex w-full max-w-md items-center gap-2.5 overflow-hidden text-left',
        'rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm transition-colors',
        'hover:border-muted-foreground/40',
        streaming ? 'cursor-default opacity-80' : 'cursor-pointer',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm font-medium text-foreground',
            streaming && 'text-foreground/55',
          )}
        >
          {title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/50" />
              {lineCount} 行…
            </span>
          ) : (
            <>
              <span className="rounded bg-muted/60 px-1 py-px">{KIND_LABEL[detection.kind]}</span>
              {versionCount > 1 && <span className="tabular-nums">v{versionCount}</span>}
            </>
          )}
        </span>
      </span>
      {!streaming && (
        <span className="shrink-0 text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover/artifact:opacity-100">
          打开
        </span>
      )}
    </button>
  );
});

/**
 * Artifact 浮层预览（Hermes 右栏；ELEVE 先用浮层承载，portal 到 body）：
 * - html → sandbox iframe（srcDoc，禁脚本外联）
 * - svg → blob URL → img
 * - code → renderMarkdown 高亮代码卡片 + 复制
 * 版本切换 v1/v2…；ESC / 遮罩关闭。
 */
export function ArtifactPreviewOverlay() {
  const openState = useOpenArtifact();
  const [copied, setCopied] = useState(false);

  const data = useMemo(() => {
    if (!openState) return null;
    return findArtifactVersion(openState.id, openState.versionIndex);
  }, [openState]);

  const svgUrl = useMemo(() => {
    if (!data || data.record.kind !== 'svg') return null;
    const blob = new Blob([data.version.content], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }, [data]);

  useEffect(() => {
    if (!svgUrl) return;
    return () => URL.revokeObjectURL(svgUrl);
  }, [svgUrl]);

  useEffect(() => {
    if (!openState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeArtifact();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openState]);

  if (!openState || !data) return null;

  const { record, version } = data;
  const Icon = KIND_ICON[record.kind];

  const handleCopy = () => {
    navigator.clipboard.writeText(version.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--ui-bg-chrome) 70%, transparent)' }}
      onClick={() => closeArtifact()}
    >
      <div
        className="flex h-[80vh] w-[min(90vw,960px)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：图标 + 标题 + 类型/版本 + 操作 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground">
            <Icon size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{record.title}</span>
          <span className="rounded bg-muted/60 px-1.5 py-px text-xs text-muted-foreground">
            {KIND_LABEL[record.kind]}
          </span>
          {record.versions.length > 1 && (
            <span className="flex items-center gap-1">
              {record.versions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectArtifactVersion(record.id, i)}
                  className={cn(
                    'rounded px-1.5 py-px text-xs transition-colors',
                    i === openState.versionIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  v{i + 1}
                </button>
              ))}
            </span>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              copied && 'text-success',
            )}
            title={copied ? '已复制' : '复制内容'}
          >
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
          <button
            type="button"
            onClick={() => closeArtifact()}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="关闭 (Esc)"
          >
            <DeleteIcon size={13} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {record.kind === 'html' && (
            <iframe
              sandbox="allow-scripts"
              srcDoc={version.content}
              className="h-full w-full rounded-lg border border-border bg-white"
              title={record.title}
            />
          )}
          {record.kind === 'svg' && svgUrl && (
            <div className="flex h-full items-center justify-center">
              <img src={svgUrl} alt={record.title} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {record.kind === 'code' && (
            <div
              className="prose max-w-none wrap-anywhere text-pretty [&>*+*]:mt-(--paragraph-gap) [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(`\`\`\`${record.language}\n${version.content}\n\`\`\``),
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
