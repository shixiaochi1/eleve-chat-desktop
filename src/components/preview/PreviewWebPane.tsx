/**
 * PreviewWebPane — URL 预览内容区（对齐 Hermes PreviewPane 的 url target 分支）
 *
 * 原 PreviewPanel 改造为多 Tab 预览中心的 url 内容区：
 * - URL 输入 + iframe（sandbox + 协议白名单保留）
 * - 重启：RPC preview.restart → store 重启状态机
 *   （progress/complete 事件由 lib/preview-events 全局路由写入 store，本组件只读）
 * - 自动刷新：store reloadRequest（文件变更自动刷新）→ iframe 重载
 *
 * 架构：本组件无 WS 事件监听（预览域事件统一在 lib/preview-events 单点路由），
 * 对齐 Hermes use-preview-routing → store → PreviewPane 单向数据流。
 */

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, AlertCircle, Loader2, Globe, RefreshCw } from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { getWsClient } from '@/services/ws-client';
import { cn } from '@/lib/utils';
import {
  type PreviewTab,
  beginPreviewRestart,
  failPreviewRestartRequest,
  usePreviewStore,
} from '@/store/preview';

interface PreviewWebPaneProps {
  tab: PreviewTab;
  sessionId?: string | null;
  cwd?: string;
}

/**
 * 预览 URL 安全校验：仅允许 http:/https: 协议。
 * 拒绝 javascript:/file:/data:/blob: 等——防止提示注入诱导加载本地文件或脚本 URL。
 * 预览必须是绝对 URL（占位提示即 http://localhost:3000），相对/非法 URL 一律拒绝。
 */
function isSafePreviewUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function PreviewWebPane({ tab, sessionId, cwd }: PreviewWebPaneProps) {
  const { reloadRequest, restart } = usePreviewStore();
  const [url, setUrl] = useState(tab.target.url);
  const [iframeKey, setIframeKey] = useState(0);
  // 错误分类（对齐 Hermes loadErrorTitle 两级：serverNotFound / failedToLoad；
  // module mime 类依赖 webview console 检测，iframe 不可得 → 标注限制）
  const [iframeError, setIframeError] = useState<'serverNotFound' | 'failed' | null>(null);

  // tab 切换 → URL 输入框重置为 tab 目标
  useEffect(() => {
    setUrl(tab.target.url);
    setIframeError(null);
  }, [tab.id, tab.target.url]);

  // 自动刷新：文件变更（tool.complete + inline_diff → requestPreviewReload）
  useEffect(() => {
    if (reloadRequest > 0) setIframeKey((k) => k + 1);
  }, [reloadRequest]);

  // 重启成功 → 自动刷新 iframe（对齐 Hermes complete 后 requestPreviewReload 语义）
  useEffect(() => {
    if (restart?.status === 'success' && restart.url === (url.trim() || tab.target.url)) {
      setIframeKey((k) => k + 1);
      setIframeError(null);
    }
  }, [restart, url, tab.target.url]);

  // ── 重启预览（对齐 Hermes restartPreviewServer）──
  const handleRestart = useCallback(async () => {
    const targetUrl = url.trim();
    if (!targetUrl || !sessionId) return;

    try {
      const wsClient = getWsClient();
      const result = (await wsClient.sendRpc('preview.restart', {
        session_id: sessionId,
        url: targetUrl,
        cwd: cwd || '',
        context: iframeError ? 'Preview failed to load' : '',
      })) as { task_id?: string };

      const taskId = result?.task_id || '';
      if (!taskId) {
        throw new Error('Background restart did not return a task id');
      }
      beginPreviewRestart(taskId, targetUrl);
    } catch (e) {
      failPreviewRestartRequest(
        targetUrl,
        `error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [url, sessionId, cwd, iframeError]);

  // ── 手动加载 ──
  const handleLoad = useCallback(() => {
    if (url.trim()) {
      setIframeKey((k) => k + 1);
      setIframeError(null);
    }
  }, [url]);

  // ── 外部打开：系统浏览器（tauri-plugin-shell，对齐 Hermes openExternal）──
  const handleOpenExternal = useCallback(() => {
    const target = url.trim() || tab.target.url;
    if (!target) return;
    try {
      void shellOpen(target);
    } catch (e) {
      // 浏览器模式降级 window.open
      window.open(target, '_blank');
    }
  }, [url, tab.target.url]);

  // ── iframe 错误检测 + 分类 ──
  // iframe onload/onerror 在跨域时不可靠，用延时检测；检测到失败后
  // fetch HEAD 探测服务器可达性（对齐 Hermes loadErrorTitle 分类：
  // connection refused → serverNotFound；服务器在但页面坏 → failedToLoad）
  const handleIframeError = useCallback(() => {
    setTimeout(async () => {
      const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe');
      if (!iframe) return;
      try {
        const href = iframe.contentWindow?.location?.href;
        if (href && href !== 'about:blank') return; // 有内容 = 加载成功
      } catch {
        return; // 跨域 = 有内容，加载成功
      }

      // 页面空白/加载失败 → 探测服务器可达性
      const target = url.trim() || tab.target.url;
      try {
        await fetch(target, { method: 'HEAD', mode: 'no-cors' });
        setIframeError('failed'); // 服务器可达但页面未正常加载
      } catch {
        setIframeError('serverNotFound'); // connection refused / 网络不可达
      }
    }, 2000);
  }, [url, tab.target.url]);

  // 重启状态归属：仅当前 pane 的 URL 关联（Hermes restartingServer 同款判断）
  const currentUrl = url.trim() || tab.target.url;
  const isRestarting = restart?.status === 'running' && restart.url === currentUrl;
  const restartEntries = restart && restart.url === currentUrl ? restart.entries : [];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--ui-bg-editor)]">
      {/* ── URL 输入栏 ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <Globe size={14} className="text-[var(--ui-text-tertiary)] shrink-0" />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLoad();
          }}
          placeholder="http://localhost:3000"
          className="flex-1 min-w-0 bg-transparent text-xs text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] outline-none border-none"
        />
        <button
          onClick={handleLoad}
          disabled={!url.trim()}
          className="flex items-center justify-center w-6 h-6 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="加载"
        >
          <ExternalLink size={13} />
        </button>
        <button
          onClick={handleRestart}
          disabled={!url.trim() || !sessionId || isRestarting}
          className={cn(
            'flex items-center gap-1 px-2 h-6 rounded text-xs font-medium transition-colors',
            isRestarting
              ? 'bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-tertiary)] cursor-wait'
              : 'bg-[var(--ui-accent-primary)] text-primary-foreground hover:bg-[var(--ui-accent-primary-hover)]',
            (!url.trim() || !sessionId) && 'opacity-40 cursor-not-allowed'
          )}
          title="重启预览服务器"
        >
          {isRestarting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          <span>{isRestarting ? '重启中' : '重启'}</span>
        </button>
      </div>

      {/* ── iframe 预览区 ── */}
      <div className="flex-1 min-h-0 relative bg-background">
        {!url.trim() ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <Globe size={32} strokeWidth={1} />
            <span className="text-xs">输入 URL 开始预览</span>
          </div>
        ) : !isSafePreviewUrl(url) ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <AlertCircle size={32} strokeWidth={1} className="text-[var(--ui-status-warning)]" />
            <span className="text-xs">仅支持 http:// 或 https:// 地址</span>
          </div>
        ) : (
          /*
           * sandbox 保留 allow-same-origin：iframe 加载用户自己的 dev server（http://localhost），
           * 与 Tauri 父窗口（tauri:// 协议）天然跨域，故 allow-scripts+allow-same-origin 的
           * “iframe 移除自身 sandbox”逃逸不成立（父子不同源）；而 dev 预览（Vite HMR / 同源
           * fetch）需要 allow-same-origin 才能正常工作。无 allow-top-navigation，sandbox 仍限制
           * 顶层导航。安全边界由上方 isSafePreviewUrl 协议白名单把控。
           */
          <iframe
            key={iframeKey}
            id="preview-iframe"
            src={url.trim()}
            onLoad={handleIframeError}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            title="Preview"
          />
        )}

      {/* iframe 加载错误覆盖层（分类文案，对齐 Hermes PreviewLoadError） */}
      {iframeError && !isRestarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--ui-bg-editor)] gap-3">
          <AlertCircle size={32} className="text-[var(--ui-status-warning)]" strokeWidth={1.5} />
          <span className="text-xs text-[var(--ui-text-secondary)]">
            {iframeError === 'serverNotFound' ? '无法连接到服务器' : '预览加载失败'}
          </span>
          <span className="text-[10px] text-[var(--ui-text-tertiary)] max-w-[80%] truncate" title={url.trim() || tab.target.url}>
            {url.trim() || tab.target.url}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoad}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] transition-colors"
            >
              <RefreshCw size={12} />
              重试
            </button>
            <button
              onClick={handleOpenExternal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] transition-colors"
            >
              <ExternalLink size={12} />
              外部打开
            </button>
            <button
              onClick={handleRestart}
              disabled={!sessionId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--ui-accent-primary)] text-primary-foreground hover:bg-[var(--ui-accent-primary-hover)] disabled:opacity-40 transition-colors"
            >
              <Loader2 size={12} className={isRestarting ? 'animate-spin' : ''} />
              重启预览服务器
            </button>
          </div>
        </div>
      )}
      </div>

      {/* ── 进度日志区（重启中/完成时显示）── */}
      {(isRestarting || restartEntries.length > 0) && (
        <div className="border-t border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-editor)] max-h-[40%] overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-medium text-[var(--ui-text-tertiary)] uppercase tracking-wide border-b border-[var(--ui-stroke-secondary)] sticky top-0 bg-[var(--ui-bg-editor)]">
            {isRestarting ? '重启进度' : '重启日志'}
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {restartEntries.map((entry, i) => (
              <div
                key={i}
                className={cn(
                  'text-[11px] font-mono leading-relaxed break-all',
                  entry.level === 'error'
                    ? 'text-[var(--ui-status-error)]'
                    : entry.level === 'warn'
                      ? 'text-[var(--ui-status-warning)]'
                      : 'text-[var(--ui-text-secondary)]'
                )}
              >
                <span className="text-[var(--ui-text-quaternary)] mr-1.5">
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
                {entry.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
