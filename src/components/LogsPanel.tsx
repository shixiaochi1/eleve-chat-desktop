/**
 * LogsPanel — 后端日志尾随面板（对齐 Hermes contrib/panes.tsx LogsPane）
 *
 * Hermes：react-query ['contrib-logs-tail'] + refetchInterval 5000 →
 * getLogs({ lines: 300 }) → <pre>{lines.join('\n')}</pre>，⌘K palette
 * "Toggle logs" 召唤临时面板。ELEVE 等价物：
 * - 5s 轮询 fetchLogs({ lines: 300 })（无 react-query，setInterval 等价语义）
 * - 文件切换 agent/gateway/error（Hermes getLogs file 参数 + ELEVE 后端
 *   /api/logs 三文件能力；Hermes 面板无 chrome 是 Electron contrib 限制，
 *   ELEVE 面板内小工具条展示后端既有能力）
 * - 自动滚底尾随（新日志追加跟随，对齐"尾随"语义）；暂停时停止滚底
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLogs, LOG_FILES, type LogsResponse } from '@/lib/logs';

const POLL_MS = 5000;
const TAIL_LINES = 300;

export default function LogsPanel() {
  const [file, setFile] = useState<'agent' | 'gateway' | 'error'>('agent');
  const [data, setData] = useState<LogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  // 轮询与 state 解耦：effect 常驻，切换文件只重置 state 不重建轮询
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const res = await fetchLogs({ file, lines: TAIL_LINES });
        if (cancelled) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    void poll();
    timer = window.setInterval(() => {
      if (!pausedRef.current) void poll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [file]);

  // 自动滚底（对齐 Hermes 尾随：新日志追加时保持在底部；用户上滚 → 停止跟随）
  useEffect(() => {
    if (!autoScroll) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    setAutoScroll(atBottom);
  }, []);

  const handleTogglePause = useCallback(() => setPaused((p) => !p), []);
  const handleRetry = useCallback(() => {
    setError(null);
    void fetchLogs({ file, lines: TAIL_LINES })
      .then((res) => { setData(res); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [file]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条：文件切换 + 暂停/继续（对齐 Hermes 无 chrome 语义的最小增强：
          后端 /api/logs 三文件能力展示；核心行为仍是 5s 轮询尾随） */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        {LOG_FILES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFile(f.id)}
            className={cn(
              'rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors',
              file === f.id
                ? 'bg-accent/15 text-foreground'
                : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={handleTogglePause}
          title={paused ? '继续轮询' : '暂停轮询'}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? '继续' : '暂停'}
        </button>
      </div>

      {/* 错误态（对齐 Hermes "log unavailable: ..."） */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <AlertCircle size={13} />
          <span className="min-w-0 flex-1 truncate">日志不可用: {error}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium underline underline-offset-4 hover:opacity-80"
          >
            重试
          </button>
        </div>
      )}

      {/* 内容：纯 tail 文本（对齐 Hermes <pre> 无 chrome） */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {data === null && !error ? (
          <div className="grid h-full place-items-center gap-2 text-muted-foreground/60">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">读取日志…</span>
          </div>
        ) : (
          <pre
            ref={bodyRef}
            onScroll={handleScroll}
            className="h-full min-h-0 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[0.66rem] leading-relaxed text-muted-foreground"
          >
            {data && data.lines.length > 0 ? data.lines.join('\n') : '（暂无日志）'}
          </pre>
        )}
      </div>
    </div>
  );
}
