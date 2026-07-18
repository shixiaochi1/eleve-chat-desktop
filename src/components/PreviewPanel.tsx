/**
 * PreviewPanel — Web 预览面板
 *
 * 对齐 Hermes apps/desktop 桌面预览功能:
 * - iframe 加载本地 dev server URL
 * - 加载失败时显示"重启预览"按钮
 * - 点击重启 → 调 preview.restart RPC → 后端创建临时 Agent 分析历史+重启 server
 * - 实时显示 progress 日志（工具执行进度）
 * - 完成后自动刷新 iframe
 *
 * 事件监听（对齐 Hermes use-preview-routing.ts）:
 * - preview.restart.progress → 追加进度日志
 * - preview.restart.complete → 结束重启状态，成功则刷新 iframe
 *
 * 架构：组件自行注册 WS 事件监听器，不侵入 useSSE 聊天事件流。
 * preview 事件是独立功能域，与聊天消息处理职责隔离。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ExternalLink, AlertCircle, Loader2, Globe } from 'lucide-react';
import { getWsClient } from '@/services/ws-client';
import { cn } from '@/lib/utils';

interface PreviewPanelProps {
  /** 当前会话 ID，用于 preview.restart RPC */
  sessionId?: string | null;
  /** 当前工作目录，作为重启的 cwd 提示 */
  cwd?: string;
}

interface ProgressEntry {
  text: string;
  level: string;
  timestamp: number;
}

type RestartStatus = 'idle' | 'restarting' | 'success' | 'error';

export default function PreviewPanel({ sessionId, cwd }: PreviewPanelProps) {
  const [url, setUrl] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeError, setIframeError] = useState(false);
  const [status, setStatus] = useState<RestartStatus>('idle');
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const taskIdRef = useRef<string | null>(null);
  const progressEndRef = useRef<HTMLDivElement>(null);

  // ── WS 事件监听（对齐 Hermes use-preview-routing.ts L100-116）──
  useEffect(() => {
    const wsClient = getWsClient();

    const handleEvent = (eventName: string, data: unknown) => {
      const raw = data as Record<string, unknown>;
      if (!raw) return;

      // payload 内聚（对齐 routeWsEvent 的 chunkBase 提取）
      const payload = (raw.payload && typeof raw.payload === 'object'
        ? raw.payload
        : raw) as Record<string, unknown>;

      if (eventName === 'preview.restart.progress') {
        const tid = payload.task_id as string;
        if (tid && tid === taskIdRef.current) {
          setProgress(prev => [...prev, {
            text: (payload.text as string) || '',
            level: (payload.level as string) || 'info',
            timestamp: Date.now(),
          }]);
        }
      } else if (eventName === 'preview.restart.complete') {
        const tid = payload.task_id as string;
        if (tid && tid === taskIdRef.current) {
          const text = (payload.text as string) || '';
          const isError = text.startsWith('error:') || text.toLowerCase().includes('failed');
          setStatus(isError ? 'error' : 'success');

          if (!isError) {
            // 成功 → 刷新 iframe（对齐 Hermes requestPreviewReload）
            setIframeKey(k => k + 1);
            setIframeError(false);
          }
          // 追加最终结果到进度日志
          setProgress(prev => [...prev, {
            text,
            level: isError ? 'error' : 'info',
            timestamp: Date.now(),
          }]);
          taskIdRef.current = null;
        }
      }
    };

    wsClient.addEventListener(handleEvent);
    return () => {
      wsClient.removeEventListener(handleEvent);
    };
  }, []);

  // ── 自动滚动进度日志到底部 ──
  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress]);

  // ── 重启预览（对齐 Hermes restartPreviewServer L70-98）──
  const handleRestart = useCallback(async () => {
    if (!url.trim()) return;
    if (!sessionId) return;

    setStatus('restarting');
    setProgress([]);
    setIframeError(false);

    try {
      const wsClient = getWsClient();
      const result = await wsClient.sendRpc('preview.restart', {
        session_id: sessionId,
        url: url.trim(),
        cwd: cwd || '',
        context: iframeError ? 'Preview failed to load' : '',
      }) as { task_id?: string };

      const taskId = result?.task_id || '';
      if (!taskId) {
        throw new Error('Background restart did not return a task id');
      }
      taskIdRef.current = taskId;
    } catch (e) {
      setStatus('error');
      setProgress(prev => [...prev, {
        text: `error: ${e instanceof Error ? e.message : String(e)}`,
        level: 'error',
        timestamp: Date.now(),
      }]);
    }
  }, [url, sessionId, cwd, iframeError]);

  // ── 手动加载 ──
  const handleLoad = useCallback(() => {
    if (url.trim()) {
      setIframeKey(k => k + 1);
      setIframeError(false);
      setStatus('idle');
    }
  }, [url]);

  // ── iframe 错误检测 ──
  const handleIframeError = useCallback(() => {
    // iframe onload/onerror 在跨域时不可靠，用延时检测
    setTimeout(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('#preview-iframe');
      if (iframe) {
        try {
          // 跨域访问会抛异常，说明加载成功（有内容）
          // 同域 access ok 说明也加载成功
          const href = iframe.contentWindow?.location?.href;
          if (!href || href === 'about:blank') {
            setIframeError(true);
          }
        } catch {
          // 跨域 → 加载成功（有内容但无法访问）
          setIframeError(false);
        }
      }
    }, 2000);
  }, []);

  const isRestarting = status === 'restarting';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--eleve-surface-background)]">
      {/* ── URL 输入栏 ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <Globe size={14} className="text-[var(--ui-text-tertiary)] shrink-0" />
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
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
              : 'bg-[var(--ui-accent-primary)] text-white hover:bg-[var(--ui-accent-primary-hover)]',
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
      <div className="flex-1 min-h-0 relative bg-white">
        {url.trim() ? (
          <iframe
            key={iframeKey}
            id="preview-iframe"
            src={url.trim()}
            onLoad={handleIframeError}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="Preview"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <Globe size={32} strokeWidth={1} />
            <span className="text-xs">输入 URL 开始预览</span>
          </div>
        )}

        {/* iframe 加载错误覆盖层 */}
        {iframeError && !isRestarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--eleve-surface-background)] gap-3">
            <AlertCircle size={32} className="text-[var(--ui-status-warning)]" strokeWidth={1.5} />
            <span className="text-xs text-[var(--ui-text-secondary)]">预览加载失败</span>
            <button
              onClick={handleRestart}
              disabled={!sessionId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--ui-accent-primary)] text-white hover:bg-[var(--ui-accent-primary-hover)] disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={12} />
              重启预览服务器
            </button>
          </div>
        )}
      </div>

      {/* ── 进度日志区（重启中/完成时显示）── */}
      {(isRestarting || progress.length > 0) && (
        <div className="border-t border-[var(--ui-stroke-secondary)] bg-[var(--eleve-surface-background)] max-h-[40%] overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-medium text-[var(--ui-text-tertiary)] uppercase tracking-wide border-b border-[var(--ui-stroke-secondary)] sticky top-0 bg-[var(--eleve-surface-background)]">
            {isRestarting ? '重启进度' : '重启日志'}
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {progress.map((entry, i) => (
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
            <div ref={progressEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
