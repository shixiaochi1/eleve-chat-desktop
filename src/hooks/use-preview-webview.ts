/**
 * usePreviewWebview — 预览子 webview 生命周期共享 hook
 * （🔴 2026-08-29 严禁重复造轮子：PreviewWebPane（URL tab）与 PreviewFilePane
 * （HTML rendered）此前各持一份同款 create/布局同步/清理代码，现统一于此）
 *
 * 语义（对齐 Hermes preview-pane webview effect）：
 * - active=false → 不创建（并销毁已有）；active 变 true → 创建
 * - reloadKey 值变化 → 销毁重建（载入新内容；undefined = 不响应）
 *   ——「加载地址」仅在 effect 执行时快照（urlRef）：运行时 url 更新
 *   （如 Browser 页面地址回写）不触发重建，导航走调用方的 navigate 路径
 * - 布局：ResizeObserver → rAF 节流（每帧至多一次）→ preview_webview_update
 * - 创建完成前卸载（异步竞态）→ 立即销毁
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface UsePreviewWebviewOptions {
  /** false = 不创建（并销毁已有）——激活条件由调用方计算 */
  active: boolean;
  /** 加载地址：http/https URL 或本地文件路径（Rust 侧 Url::from_file_path 归一化） */
  url: string;
  /** 值变化 → 销毁重建（载入新内容；undefined/恒定 = 不响应） */
  reloadKey?: unknown;
  /** 每次重建前同步调用（调用方重置 per-webview 运行态：console 游标/错误态等） */
  onRecreate?: () => void;
  /** 🔴 2026-09-01 创建失败回调（此前 catch 只 console.error，UI 黑屏无任何
   *  反馈——调用方据此显示错误态而非静默空白） */
  onCreateError?: (err: unknown) => void;
}

export interface UsePreviewWebviewResult {
  /** 原生层锚点容器（Rust 按容器 rect 摆位；挂在内容区 flex 布局内） */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Rust 生成的 webview label（null = 未就绪） */
  label: string | null;
  /** label 的 ref 镜像（navigate/reload 等异步闭包读取最新值，避开空依赖陷阱） */
  labelRef: RefObject<string | null>;
}

export function usePreviewWebview({
  active,
  url,
  reloadKey,
  onRecreate,
  onCreateError,
}: UsePreviewWebviewOptions): UsePreviewWebviewResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  // 创建地址快照：effect 执行时的 url（运行时 url 更新不触发重建，见文件头）
  const urlRef = useRef(url);
  urlRef.current = url;
  const onRecreateRef = useRef(onRecreate);
  onRecreateRef.current = onRecreate;
  const onCreateErrorRef = useRef(onCreateError);
  onCreateErrorRef.current = onCreateError;

  // ── 创建/销毁 ──
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    onRecreateRef.current?.();

    const rect = containerRef.current?.getBoundingClientRect();
    invoke<string>('preview_webview_create', {
      url: urlRef.current,
      x: rect?.x ?? 0,
      y: rect?.y ?? 0,
      width: rect?.width ?? 800,
      height: rect?.height ?? 600,
    })
      .then((l) => {
        if (cancelled) {
          // 创建完成前已卸载（异步竞态）→ 立即销毁
          invoke('preview_webview_close', { label: l }).catch(() => {});
          return;
        }
        labelRef.current = l;
        setLabel(l);
      })
      .catch((e) => {
        console.error('[preview-webview] create failed:', e);
        onCreateErrorRef.current?.(e);
      });

    return () => {
      cancelled = true;
      const l = labelRef.current;
      labelRef.current = null;
      setLabel(null);
      if (l) {
        invoke('preview_webview_close', { label: l }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url 经 ref 快照（文件头语义）
  }, [active, reloadKey]);

  // ── 布局同步（label 就绪后订阅）──
  useEffect(() => {
    if (!label) return;
    const container = containerRef.current;
    if (!container) return;

    const sync = () => {
      if (rafRef.current !== null) return; // 每帧至多一次
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rect = container.getBoundingClientRect();
        invoke('preview_webview_update', {
          label,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }).catch(() => {});
      });
    };

    const ro = new ResizeObserver(sync);
    ro.observe(container);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [label]);

  return { containerRef, label, labelRef };
}
