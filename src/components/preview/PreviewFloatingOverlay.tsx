/**
 * PreviewFloatingOverlay — 宫格模式预览浮层（🔴 2026-08-28 对齐 Hermes 修复）
 *
 * 修复"宫格预览黑洞"：旧实现 paneOpenRequest 仅 single 视图消费（App.tsx），
 * 宫格下 preview.open 事件 / #preview 链接 → tab 静默写入 store、UI 无反应。
 *
 * 对齐语义：Hermes 无宫格概念，但 open_preview 的契约是"预览对用户可见"——
 * 单视图由右栏承载，宫格（无右栏语义）由浮层承载，与 ArtifactPreviewOverlay
 * 同一架构模式（GridModeView 挂载、portal 蒙层、Escape/蒙层点击关闭）。
 *
 * 与右栏的关系：tabs 是同一全局 store（eleve.previewTabs.v1）——宫格浮层里
 * 开的 tab 切回单视图后仍在右栏「预览」tab 中，反之亦然（对齐 Hermes 全局
 * tab 列表跨上下文存活）。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X } from 'lucide-react';
import PreviewCenter from './PreviewCenter';
import { usePaneOpenRequest, usePreviewStore } from '@/store/preview';

interface PreviewFloatingOverlayProps {
  /** 焦点卡片会话（webview restart RPC 上下文；对齐单视图右栏的 sessionId 传参） */
  sessionId?: string | null;
}

export default function PreviewFloatingOverlay({ sessionId }: PreviewFloatingOverlayProps) {
  const paneOpenRequest = usePaneOpenRequest();
  const { tabs } = usePreviewStore();
  const [open, setOpen] = useState(false);
  // 仅消费"计数变化"——组件挂载时计数器可能已有历史值（单视图期间累计），
  // 不能因历史值立即弹浮层
  const lastConsumedRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastConsumedRef.current === null) {
      lastConsumedRef.current = paneOpenRequest;
      return;
    }
    if (paneOpenRequest !== lastConsumedRef.current) {
      lastConsumedRef.current = paneOpenRequest;
      setOpen(true);
    }
  }, [paneOpenRequest]);

  // tabs 全关 → 浮层无内容可显示，自动收起
  useEffect(() => {
    if (tabs.length === 0) setOpen(false);
  }, [tabs.length]);

  // Escape 关闭（对齐 ArtifactPreviewOverlay 同款键盘语义）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || tabs.length === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--ui-bg-chrome) 70%, transparent)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[85vh] w-[min(92vw,1100px)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 关闭（tab 条/内容区由 PreviewCenter 承载，与右栏同构） */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Globe size={14} className="text-info shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            预览（{tabs.length} 个标签）
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="关闭浮层"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground"
          >
            <X size={13} />
          </button>
        </div>
        <PreviewCenter sessionId={sessionId} />
      </div>
    </div>,
    document.body,
  );
}
