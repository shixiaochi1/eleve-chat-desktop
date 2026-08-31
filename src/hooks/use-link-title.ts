/**
 * use-link-title — link 产物/链接的网页标题抓取
 * （🔴 2026-08-29 对齐 Hermes lib/external-link.tsx，规则原文逐条移植：
 * normalizeExternalUrl / titleCacheKey / SKIP_PROTO_RE / LOCAL_HOST_RE /
 * ERROR_TITLE_RE / 缓存 + in-flight 去重 + 订阅广播）
 *
 * 通道差异：Hermes 走 Electron 主进程桥（hermesDesktop.fetchLinkTitle，Node.js
 * 无 CORS）；ELEVE 走 Tauri invoke('fetch_link_title')（Rust reqwest，同样
 * 无 CORS）。无桥/失败 → 返回空串，调用方降级显示 URL 末段（Hermes 同款）。
 *
 * 🔴 2026-09-01 分层归位：lib/ → hooks/（hook 文件归位 hooks 层，纯移动）。
 */

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const titleCache = new Map<string, string>();
const titleInflight = new Map<string, Promise<string>>();
const titleSubs = new Map<string, Set<(value: string) => void>>();

const SKIP_PROTO_RE = /^(?:file|data|mailto|javascript|blob|chrome|about|eleve):/i;
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i;
const ERROR_TITLE_RE =
  /\b(?:access denied|attention required|captcha|error|forbidden|just a moment|not found|request blocked|too many requests)\b/i;

const DOMAIN_RE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i;

export function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return DOMAIN_RE.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function parseUrl(value: string): null | URL {
  try {
    return new URL(normalizeExternalUrl(value));
  } catch {
    return null;
  }
}

/** 缓存键：host（剥 www）+ 去尾斜杠 pathname + search——同页不同尾斜杠共享一次抓取 */
function titleCacheKey(value: string): string {
  const url = parseUrl(value);
  if (!url) {
    return normalizeExternalUrl(value);
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '') || '/';
  return `${host}${pathname}${url.search || ''}`;
}

/** 是否值得抓：http(s) 且非本地 host（对齐 Hermes isTitleFetchable） */
export function isTitleFetchable(value: string): boolean {
  if (!value || SKIP_PROTO_RE.test(value)) {
    return false;
  }
  const url = parseUrl(value);
  return Boolean(url && /^https?:$/.test(url.protocol) && !LOCAL_HOST_RE.test(url.host));
}

export async function fetchLinkTitle(url: string): Promise<string> {
  const normalizedUrl = normalizeExternalUrl(url);
  const key = titleCacheKey(normalizedUrl);

  if (!isTitleFetchable(normalizedUrl)) {
    return '';
  }
  if (titleCache.has(key)) {
    return titleCache.get(key) ?? '';
  }
  const pending = titleInflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = invoke<string>('fetch_link_title', { url: normalizedUrl })
    .then((value) => (value || '').replace(/\s+/g, ' ').trim())
    .then((clean) => (clean && !ERROR_TITLE_RE.test(clean) ? clean : ''))
    .catch(() => '')
    .then((safe) => {
      titleCache.set(key, safe);
      titleInflight.delete(key);
      titleSubs.get(key)?.forEach((sub) => sub(safe));
      return safe;
    });

  titleInflight.set(key, promise);
  return promise;
}

/** 订阅式标题钩子（同 key 的多个卡片共享一次抓取与结果广播） */
export function useLinkTitle(url?: null | string): string {
  const normalizedUrl = useMemo(() => (url ? normalizeExternalUrl(url) : ''), [url]);
  const key = useMemo(() => (normalizedUrl ? titleCacheKey(normalizedUrl) : ''), [normalizedUrl]);
  const [title, setTitle] = useState(() => (key ? (titleCache.get(key) ?? '') : ''));

  useEffect(() => {
    setTitle(key ? (titleCache.get(key) ?? '') : '');

    if (!key || !isTitleFetchable(normalizedUrl)) {
      return;
    }

    const subs = titleSubs.get(key) ?? new Set<(value: string) => void>();
    subs.add(setTitle);
    titleSubs.set(key, subs);
    void fetchLinkTitle(normalizedUrl);

    return () => {
      subs.delete(setTitle);
      if (!subs.size) {
        titleSubs.delete(key);
      }
    };
  }, [key, normalizedUrl]);

  return title;
}

/** 测试/热重载辅助（对齐 Hermes __resetLinkTitleCache） */
export function __resetLinkTitleCache(): void {
  titleCache.clear();
  titleInflight.clear();
  titleSubs.clear();
}
