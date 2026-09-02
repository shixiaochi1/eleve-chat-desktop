/**
 * use-favicon — 站点图标（favicon）解析 hook + Favicon 占位组件
 * （🔴 2026-08-29 对齐 Hermes components/ui/favicon.tsx + electron/favicon.ts）
 *
 * 职责分层对齐 Hermes：图标抓取/解析/排名全在主进程（ELEVE = src-tauri
 * external_fetch.rs::fetch_favicon，"the thorough way" 阶梯），本模块只做
 * 请求、等待与占位。缓存/in-flight 去重/订阅广播复用 use-link-title.ts
 * 同款模式（铁律 4 共享模式）。
 *
 * Hermes 语义：data URL 而非链接（渲染免二次网络往返、站点挂了图标仍在、
 * 一个缓存串覆盖所有展示面）；空串 = 主进程已完整走完阶梯仍无图标，
 * 保留调用方字形占位，不闪破图、绝不重试。
 *
 * 有意偏差：Hermes 组件 pending 态渲染 spinner（连接器 logo 场景，单个大
 * 图标）；ELEVE 用于画廊行内 14px 小格，成排转圈噪音大于价值，pending
 * 直接显示 fallback 字形。
 *
 * 🔴 2026-09-01 分层归位：lib/ → hooks/（hook 文件归位 hooks 层，纯移动）。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { isTitleFetchable, normalizeExternalUrl } from '@/hooks/use-link-title';

/** url → data URL；'' = 已失败不重试。模块级缓存：重挂载不再跨 IPC
 *  🔴 2026-09-02 内存治理（第三轮复核）：加 LRU 上限——值为 base64 data URL
 *  （几 KB~几十 KB/条），此前无上限线性累积（长跑 + 大量外链会话场景）。
 *  LRU 序由 Map 保序实现（命中/写入置顶，超限驱逐最旧）。''（失败标记）同样
 *  入缓存占位——防重试语义与 LRU 驱逐后可重抓并存（驱逐即遗忘失败标记）。 */
const resolved = new Map<string, string>();
const RESOLVED_MAX = 256;

function getResolved(url: string): string | undefined {
  const v = resolved.get(url);
  if (v !== undefined) {
    // LRU 命中置顶
    resolved.delete(url);
    resolved.set(url, v);
  }
  return v;
}

function cacheResolved(url: string, icon: string): void {
  resolved.delete(url);
  resolved.set(url, icon);
  if (resolved.size > RESOLVED_MAX) {
    const oldest = resolved.keys().next().value;
    if (oldest !== undefined) resolved.delete(oldest);
  }
}

const inflight = new Map<string, Promise<string>>();
const subs = new Map<string, Set<(value: string) => void>>();

export async function fetchFavicon(url: string): Promise<string> {
  const normalized = normalizeExternalUrl(url);
  // 前端先筛（http(s) + 非本地 host，与 title 抓取同门槛）；
  // Rust isPublicHttpUrl 是最终防线（内网/loopback 拒绝）
  if (!normalized || !isTitleFetchable(normalized)) {
    return '';
  }
  const cached = getResolved(normalized);
  if (cached !== undefined) {
    return cached;
  }
  const pending = inflight.get(normalized);
  if (pending) {
    return pending;
  }

  const promise = invoke<string>('fetch_favicon', { url: normalized })
    .then((value) => value || '')
    .catch(() => '')
    .then((icon) => {
      cacheResolved(normalized, icon);
      inflight.delete(normalized);
      subs.get(normalized)?.forEach((sub) => sub(icon));
      return icon;
    });
  inflight.set(normalized, promise);
  return promise;
}

/** 订阅式站点图标 hook（同 URL 多处共享一次抓取与结果广播） */
export function useFavicon(url?: null | string): string {
  const normalizedUrl = useMemo(() => (url ? normalizeExternalUrl(url) : ''), [url]);
  const [icon, setIcon] = useState(() => (normalizedUrl ? (getResolved(normalizedUrl) ?? '') : ''));

  useEffect(() => {
    setIcon(normalizedUrl ? (getResolved(normalizedUrl) ?? '') : '');
    if (!normalizedUrl || !isTitleFetchable(normalizedUrl)) {
      return;
    }

    const set = subs.get(normalizedUrl) ?? new Set<(value: string) => void>();
    set.add(setIcon);
    subs.set(normalizedUrl, set);
    void fetchFavicon(normalizedUrl);

    return () => {
      set.delete(setIcon);
      if (!set.size) {
        subs.delete(normalizedUrl);
      }
    };
  }, [normalizedUrl]);

  return icon;
}

/**
 * 站点图标占位组件（Hermes Favicon 同款契约）：
 * 有图标 → img；解析中/无图标 → 调用方字形（保留占位，不闪破图）
 */
export function Favicon({
  className,
  fallback,
  title,
  url,
}: {
  className?: string;
  fallback: ReactNode;
  title?: string;
  url?: null | string;
}) {
  const icon = useFavicon(url);
  return (
    <span className={cn('inline-grid size-full place-items-center', className)} title={title}>
      {icon ? (
        <img alt="" aria-hidden className="size-full object-contain" src={icon} />
      ) : (
        fallback
      )}
    </span>
  );
}

/** 测试/热重载辅助（对齐 use-link-title __resetLinkTitleCache） */
export function __resetFaviconCache(): void {
  resolved.clear();
  inflight.clear();
  subs.clear();
}
