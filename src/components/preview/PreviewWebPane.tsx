/**
 * PreviewWebPane — URL 预览内容区（对齐 Hermes PreviewPane 的 url target 分支）
 *
 * 渲染层双模式（方案定稿）：
 * - Tauri 模式：iframe → 原生子 Webview（Rust PreviewWebviewManager 统一管理）。
 *   console 捕获注入脚本 → Rust 缓冲治理（100ms 批量）→ preview-console 事件 →
 *   本组件按 label 分流 → console store（seq 断档 → snapshot 补拉）
 * - 浏览器模式（非 Tauri dev）：iframe fallback（无 console，功能降级提示）
 *
 * 其它能力保持（对齐 Hermes）：
 * - 重启：RPC preview.restart → store 重启状态机（lib/preview-events 单点路由）
 * - 自动刷新：store reloadRequest（文件变更自动刷新）→ webview.reload / iframe key++
 * - 错误分类：serverNotFound（探测失败）/ failed（保守） / moduleMime（console 流检测，
 *   对齐 Hermes isModuleMimeError —— 子 webview 下 module mime 依赖 console 捕获）
 * - devtools 开关（对齐 Hermes devtoolsOpen 按钮，Rust preview_webview_devtools）
 * - 页面控制台面板（全量移植 Hermes preview-console）
 *
 * 布局同步：ResizeObserver → rAF 节流（每帧至多一次）→ preview_webview_update
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalLink, AlertCircle, Loader2, Globe, RefreshCw, Bug, PanelBottom } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { getWsClient } from '@/services/ws-client';
import { isDesktop } from '@/utils/bridge';
import { cn } from '@/lib/utils';
import { createPreviewConsoleState, isNearConsoleBottom } from '@/store/preview-console';
import { PreviewConsolePanel, formatLogLine } from './PreviewConsolePanel';
import {
  type PreviewTab,
  beginPreviewRestart,
  failPreviewRestart,
  failPreviewRestartRequest,
  usePreviewStore,
} from '@/store/preview';
import { notifySuccess, notifyError } from '@/utils/notifications';

interface PreviewWebPaneProps {
  tab: PreviewTab;
  sessionId?: string | null;
  cwd?: string;
}

/** Rust 侧推送的 console 条目（PreviewConsoleBuffer，per-label seq 游标） */
interface PreviewConsolePushEntry {
  label: string;
  seq: number;
  level: number;
  message: string;
  source: string | null;
  line: number | null;
}

/** 预览 URL 安全校验：仅允许 http:/https: 协议（同现有 iframe 白名单） */
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

/** module mime 错误检测（对齐 Hermes preview-pane isModuleMimeError） */
function isModuleMimeError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('failed to load module script') && lower.includes('mime type');
}

export default function PreviewWebPane({ tab, sessionId, cwd }: PreviewWebPaneProps) {
  const { reloadRequest, restart } = usePreviewStore();
  const [url, setUrl] = useState(tab.target.url);
  // 浏览器模式 iframe 重建计数
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeError, setIframeError] = useState<'serverNotFound' | 'failed' | 'moduleMime' | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 子 webview label（Rust 生成；ref 同步最新值供 cleanup/navigate 使用）
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);
  const webviewLabelRef = useRef<string | null>(null);
  // 页面控制台（per pane 实例，对齐 Hermes per-pane consoleState）
  const [consoleState] = useState(() => createPreviewConsoleState());
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);
  const consoleShouldStickRef = useRef(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  // Rust seq 游标（断档检测 → snapshot 补拉）
  const lastSeqRef = useRef<number | null>(null);
  const layoutRafRef = useRef<number | null>(null);
  const probeTimerRef = useRef<number | null>(null);
  const isTauri = isDesktop();

  // 最新 URL 供异步探测/刷新闭包使用（老铁律：空依赖 effect 闭包陷阱）
  const currentUrlRef = useRef(url.trim() || tab.target.url);
  currentUrlRef.current = url.trim() || tab.target.url;

  // tab 切换 → URL 输入框重置为 tab 目标（对齐 Hermes：仅 target.url 变化时重置，
  // 同 URL 切 tab 保留输入框本地编辑/页面状态——Hermes currentUrl 同款语义）
  useEffect(() => {
    setUrl(tab.target.url);
    setIframeError(null);
  }, [tab.target.url]);

  // ── 子 webview 创建/销毁（对齐 Hermes preview-pane webview effect：
  //    依赖 [target.kind, target.url]——URL 变化才重建，同 URL 切 tab 保留
  //    webview/页面状态。旧实现挂载时创建 + key remount 无条件重建）──
  useEffect(() => {
    if (!isTauri || !tab.target.url) return;
    let cancelled = false;

    // 重建 = 新页面新会话：Rust 侧 close 会销毁 per-label 缓冲，前端同步重置
    lastSeqRef.current = null;
    consoleState.reset();
    setDevtoolsOpen(false);
    setIframeError(null);

    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const x = rect?.x ?? 0;
    const y = rect?.y ?? 0;
    const width = rect?.width ?? 800;
    const height = rect?.height ?? 600;

    invoke('preview_webview_create', { url: tab.target.url, x, y, width, height })
      .then((label) => {
        if (cancelled) {
          // 创建完成前已卸载（异步竞态）→ 立即销毁
          invoke('preview_webview_close', { label }).catch(() => {});
          return;
        }
        webviewLabelRef.current = label as string;
        setWebviewLabel(label as string);
      })
      .catch((e) => {
        console.error('[preview] webview create failed:', e);
      });

    return () => {
      cancelled = true;
      const label = webviewLabelRef.current;
      webviewLabelRef.current = null;
      setWebviewLabel(null);
      if (label) {
        invoke('preview_webview_close', { label }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL 变化重建（对齐
    // Hermes）；同 URL 的 pane 内导航（用户改 URL 点加载）走 navigate 不重建
  }, [tab.target.url, isTauri]);

  // ── 布局同步：ResizeObserver → rAF 节流 → update（对齐方案：前端 rAF 节流上报）──
  useEffect(() => {
    if (!webviewLabel || !isTauri) return;
    const container = containerRef.current;
    if (!container) return;

    const sync = () => {
      if (layoutRafRef.current !== null) return; // 每帧至多一次
      layoutRafRef.current = requestAnimationFrame(() => {
        layoutRafRef.current = null;
        const rect = container.getBoundingClientRect();
        invoke('preview_webview_update', {
          label: webviewLabel,
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
      if (layoutRafRef.current !== null) {
        cancelAnimationFrame(layoutRafRef.current);
        layoutRafRef.current = null;
      }
    };
  }, [webviewLabel, isTauri]);

  // ── console 事件 + 加载状态事件（webview 就绪后订阅；按 label 分流）──
  useEffect(() => {
    if (!webviewLabel) return;
    let unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const onConsole = async (event: { payload: unknown }) => {
      const entries = event.payload as PreviewConsolePushEntry[];
      if (!Array.isArray(entries)) return;
      const mine = entries.filter((e) => e && e.label === webviewLabel);
      if (mine.length === 0) return;

      // seq 断档检测（per-label 游标连续 → 增量追加；断档 → snapshot 全量补拉）
      let gap = false;
      for (const e of mine) {
        if (lastSeqRef.current !== null && e.seq !== lastSeqRef.current + 1) {
          gap = true;
          break;
        }
        lastSeqRef.current = e.seq;
      }

      if (gap) {
        try {
          const [snapEntries, snapSeq] = (await invoke('preview_console_snapshot', {
            label: webviewLabel,
          })) as [PreviewConsolePushEntry[], number];
          consoleState.replace(
            snapEntries.map((e) => ({
              level: e.level,
              message: e.message,
              source: e.source ?? undefined,
              line: e.line ?? undefined,
            }))
          );
          lastSeqRef.current = snapSeq;
          return;
        } catch {
          // snapshot 失败 → 降级本批增量（尽力而为，不阻塞）
        }
      }

      // module mime 检测（对齐 Hermes onConsole：level>=3 + isModuleMimeError）
      if (mine.some((e) => e.level >= 3 && isModuleMimeError(e.message))) {
        setIframeError('moduleMime');
      }

      // 滚底跟随：追加前记录 stick 状态（对齐 Hermes appendConsoleEntry）
      consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current);
      for (const e of mine) {
        consoleState.append({
          level: e.level,
          message: e.message,
          source: e.source ?? undefined,
          line: e.line ?? undefined,
        });
      }
    };

    const onLoadState = (event: { payload: { label: string; state: string } }) => {
      const { label, state } = event.payload;
      if (label !== webviewLabel) return;
      if (state === 'started') {
        setIframeError(null);
      } else if (state === 'finished') {
        // 加载结束 → 探测服务器可达性（失败导航也触发 Finished；
        // 成功则不报错——宁漏勿误，module mime 由 console 流检测）
        if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
        probeTimerRef.current = window.setTimeout(async () => {
          probeTimerRef.current = null;
          try {
            await fetch(currentUrlRef.current, { method: 'HEAD', mode: 'no-cors' });
          } catch {
            setIframeError('serverNotFound');
          }
        }, 800);
      }
    };

    void (async () => {
      const [c, l] = await Promise.all([
        listen('preview-console', onConsole),
        listen('preview-load-state', onLoadState),
      ]);
      if (cancelled) {
        c();
        l();
        return;
      }
      unlisteners = [c, l];
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [webviewLabel, consoleState]);

  // ── 自动刷新：文件变更（tool.complete + inline_diff → requestPreviewReload）──
  useEffect(() => {
    if (reloadRequest <= 0) return;
    if (webviewLabelRef.current && isTauri) {
      invoke('preview_webview_reload', { label: webviewLabelRef.current }).catch(() => {});
    } else {
      setIframeKey((k) => k + 1);
    }
  }, [reloadRequest, isTauri]);

  // ── 重启成功 → 自动刷新（对齐 Hermes complete 后 requestPreviewReload 语义）──
  useEffect(() => {
    if (restart?.status === 'success' && restart.url === (url.trim() || tab.target.url)) {
      if (webviewLabelRef.current && isTauri) {
        invoke('preview_webview_reload', { label: webviewLabelRef.current }).catch(() => {});
      } else {
        setIframeKey((k) => k + 1);
      }
      setIframeError(null);
    }
  }, [restart, url, tab.target.url, isTauri]);

  // ── 重启预览（对齐 Hermes restartPreviewServer）──
  const handleRestart = useCallback(async () => {
    const targetUrl = url.trim();
    if (!targetUrl) return;

    // 🔴 对齐 Hermes：无活跃会话时明确报错（Hermes throw 'No active session
    // for background restart' → catch → console entry + notify），绝不静默
    // 返回（旧行为：按钮 disabled 无任何提示，用户不知道为什么点不了）。
    if (!sessionId) {
      failPreviewRestartRequest(
        targetUrl,
        '没有活跃会话，无法启动后台重启（请先打开或新建一个会话）',
      );
      return;
    }

    try {
      const wsClient = getWsClient();
      // 对齐 Hermes restartServer：把最近 12 条页面 console 日志作为上下文带给
      // 后台 agent（Hermes consoleState.$logs.slice(-12).map(formatLogLine)）；
      // 无日志时退回旧的错误提示
      const consoleContext = consoleState
        .getLogs()
        .slice(-12)
        .map(formatLogLine)
        .join('\n');
      const context = consoleContext || (iframeError ? 'Preview failed to load' : '');
      const result = (await wsClient.sendRpc('preview.restart', {
        session_id: sessionId,
        url: targetUrl,
        cwd: cwd || '',
        context,
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
  }, [url, sessionId, cwd, iframeError, consoleState]);

  // ── 手动加载：webview navigate（新页面新会话，Rust 侧清缓冲）／iframe 重建 ──
  const handleLoad = useCallback(() => {
    const target = url.trim();
    if (!target) return;
    if (webviewLabelRef.current && isTauri) {
      lastSeqRef.current = null; // 新页面 seq 从 0 重新开始
      consoleState.reset(); // 本地 console 清空（Rust 侧同步清缓冲）
      setIframeError(null);
      invoke('preview_webview_navigate', { label: webviewLabelRef.current, url: target }).catch(
        () => {},
      );
    } else {
      setIframeKey((k) => k + 1);
      setIframeError(null);
    }
  }, [url, isTauri, consoleState]);

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

  // ── iframe 错误检测 + 分类（浏览器模式；webview 模式走 onLoadState + console 流）──
  const handleIframeError = useCallback(() => {
    setTimeout(async () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      try {
        const href = iframe.contentWindow?.location?.href;
        if (href && href !== 'about:blank') return; // 有内容 = 加载成功
      } catch {
        return; // 跨域 = 有内容，加载成功
      }
      const target = url.trim() || tab.target.url;
      try {
        await fetch(target, { method: 'HEAD', mode: 'no-cors' });
        setIframeError('failed');
      } catch {
        setIframeError('serverNotFound');
      }
    }, 2000);
  }, [url, tab.target.url]);

  // ── devtools 开关（对齐 Hermes devtoolsOpen 前端状态驱动；open/close 显式传参）──
  // wry Windows 的 close_devtools 是空函数——关闭 devtools 窗口需手动（Alt+F4），
  // 但按钮状态仍正常切换，语义与 Hermes 一致（可开可切换状态）
  const handleToggleDevTools = useCallback(() => {
    if (!webviewLabelRef.current) return;
    const next = !devtoolsOpen;
    invoke('preview_webview_devtools', { label: webviewLabelRef.current, open: next })
      .then((open) => setDevtoolsOpen(Boolean(open)))
      .catch(() => {});
  }, [devtoolsOpen]);

  // 错误覆盖层显示时 hide 子 webview（DOM 盖不住原生 HWND，只能隐藏让覆盖层可见）；
  // 覆盖层消失（重试/导航/刷新）→ show 恢复
  useEffect(() => {
    if (!webviewLabelRef.current || !isTauri) return;
    invoke('preview_webview_visible', {
      label: webviewLabelRef.current,
      visible: !iframeError,
    }).catch(() => {});
  }, [iframeError, isTauri]);

  // 重启状态归属：仅当前 pane 的 URL 关联（Hermes restartingServer 同款判断）
  const currentUrl = url.trim() || tab.target.url;
  const isRestarting = restart?.status === 'running' && restart.url === currentUrl;
  const restartEntries = restart && restart.url === currentUrl ? restart.entries : [];

  // ── 重启 45s 超时（对齐 Hermes SERVER_RESTART_TIMEOUT_MS → failPreviewRestart：
  //    任务卡住时状态置 error，按钮脱离无限转圈）──
  useEffect(() => {
    const r = restart;
    if (!r || r.status !== 'running' || r.url !== currentUrl) return;
    const taskId = r.taskId;
    const timer = window.setTimeout(() => {
      failPreviewRestart(taskId, '仍在进行中，请稍后重试');
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [restart, currentUrl]);

  // ── 重启完成/失败通知（对齐 Hermes：complete → notify success；error → notify warning）──
  useEffect(() => {
    const r = restart;
    if (!r || r.url !== currentUrl) return;
    if (r.status === 'success') {
      notifySuccess('预览服务器已重启，正在重新加载页面', '重启完成');
    } else if (r.status === 'error') {
      const last = r.entries[r.entries.length - 1];
      notifyError(new Error(last?.text ?? '未知错误'), '预览服务器重启失败');
    }
  }, [restart, currentUrl]);

  const webviewActive = isTauri && webviewLabel !== null && isSafePreviewUrl(currentUrl);

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
        {/* devtools 开关（对齐 Hermes devtoolsOpen；仅子 webview 模式可用） */}
        {webviewActive && (
          <button
            onClick={handleToggleDevTools}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded transition-colors',
              devtoolsOpen
                ? 'bg-[var(--ui-control-active-background)] text-[var(--ui-text-primary)]'
                : 'text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)]',
            )}
            title={
              devtoolsOpen
                ? '关闭开发者工具（平台限制：请在开发者工具窗口按 Alt+F4 关闭）'
                : '打开开发者工具'
            }
          >
            <Bug size={13} />
          </button>
        )}
        {/* 页面控制台开关（对齐 Hermes titlebar console toggle） */}
        {webviewActive && (
          <button
            onClick={() => setConsoleOpen((o) => !o)}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded transition-colors',
              consoleOpen
                ? 'bg-[var(--ui-control-active-background)] text-[var(--ui-text-primary)]'
                : 'text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)]',
            )}
            title={consoleOpen ? '收起页面控制台' : '打开页面控制台'}
          >
            <PanelBottom size={13} />
          </button>
        )}
        <button
          onClick={handleRestart}
          disabled={!url.trim() || isRestarting}
          className={cn(
            'flex items-center gap-1 px-2 h-6 rounded text-xs font-medium transition-colors',
            isRestarting
              ? 'bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-tertiary)] cursor-wait'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
            !url.trim() && 'opacity-40 cursor-not-allowed',
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

      {/* ── 预览区（flex-col：webviewHost + 底部控制台面板）──
          ⚠️ 子 webview 是原生 HWND 永远在 DOM 之上，控制台面板不能 absolute 覆盖，
          必须嵌入 flex 布局（面板弹出 → webviewHost 缩小 → ResizeObserver 联动 webview） */}
      <div className="flex-1 min-h-0 flex flex-col bg-background">
        <div ref={containerRef} className="flex-1 min-h-0 relative">
        {!currentUrl ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <Globe size={32} strokeWidth={1} />
            <span className="text-xs">输入 URL 开始预览</span>
          </div>
        ) : !isSafePreviewUrl(currentUrl) ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <AlertCircle size={32} strokeWidth={1} className="text-[var(--ui-yellow)]" />
            <span className="text-xs">仅支持 http:// 或 https:// 地址</span>
          </div>
        ) : webviewActive ? (
          /* 子 webview：原生层渲染，容器仅承担定位锚点（Rust 按容器 rect 摆位）；
             页面 console 经注入脚本 → Rust 缓冲 → preview-console 事件流入面板 */
          <div className="w-full h-full" />
        ) : isTauri ? (
          /* webview 创建中（label 未就绪）：空占位，不渲染 iframe（Tauri 模式无 iframe 降级） */
          <div className="w-full h-full" />
        ) : (
          /*
           * 浏览器模式 fallback iframe（非 Tauri dev）：无页面 console（注入脚本
           * 依赖 Tauri IPC），功能降级提示由错误覆盖层/控制台开关隐藏体现
           */
          <iframe
            key={iframeKey}
            ref={iframeRef}
            id="preview-iframe"
            src={currentUrl}
            onLoad={handleIframeError}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            title="Preview"
          />
        )}

        {/* 加载错误覆盖层（分类文案：moduleMime / serverNotFound / failed，对齐 Hermes loadErrorTitle）
            覆盖层是 DOM，盖不住原生子 webview → 显示时 hide webview（见下方 iframeError effect） */}
        {iframeError && !isRestarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--ui-bg-editor)] gap-3">
            <AlertCircle size={32} className="text-[var(--ui-yellow)]" strokeWidth={1.5} />
            <span className="text-xs text-[var(--ui-text-secondary)]">
              {iframeError === 'serverNotFound'
                ? '无法连接到服务器'
                : iframeError === 'moduleMime'
                  ? '页面启动失败（模块加载错误）'
                  : '预览加载失败'}
            </span>
            <span
              className="text-[10px] text-[var(--ui-text-tertiary)] max-w-[80%] truncate"
              title={currentUrl}
            >
              {currentUrl}
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
                disabled={isRestarting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                <Loader2 size={12} className={isRestarting ? 'animate-spin' : ''} />
                重启预览服务器
              </button>
            </div>
          </div>
        )}
        </div>

        {/* 页面控制台面板（flex 嵌入 webview 下方，避免被原生 HWND 盖住；
            全量对齐 Hermes PreviewConsolePanel） */}
        {webviewActive && consoleOpen && (
          <PreviewConsolePanel
            consoleBodyRef={consoleBodyRef}
            consoleShouldStickRef={consoleShouldStickRef}
            consoleState={consoleState}
          />
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
                    ? 'text-[var(--ui-red)]'
                    : entry.level === 'warn'
                      ? 'text-[var(--ui-yellow)]'
                      : 'text-[var(--ui-text-secondary)]',
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
