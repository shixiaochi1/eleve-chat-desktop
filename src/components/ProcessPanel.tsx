/**
 * ProcessPanel — 后台进程管理面板（F2 T2.2）
 *
 * 对齐 Hermes process.list/kill/stop：
 * - 列出当前会话的后台进程（PID/命令/状态/运行时长）
 * - kill 单个进程 / stop 全部进程
 * - 展开查看 output_tail
 * - 5s 自动刷新
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { notifyError, notifySuccess } from '../utils/notifications';
import { listProcesses, killProcess, stopAllProcesses, type ProcessInfo } from '../utils/api';
import { Terminal, Square, XCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

interface ProcessPanelProps {
  sessionId?: string;
  [key: string]: unknown;
}

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export default function ProcessPanel({ sessionId }: ProcessPanelProps) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await listProcesses(sessionId);
      setProcesses(res.processes || []);
    } catch {
      // 静默失败（会话可能不存在）
    }
  }, [sessionId]);

  // 首次加载 + 5s 自动刷新
  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    timerRef.current = setInterval(refresh, 5000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  const handleKill = useCallback(async (pid: string) => {
    if (!sessionId) return;
    try {
      await killProcess(sessionId, pid);
      notifySuccess('进程已终止');
      refresh();
    } catch (e) {
      notifyError(e, '终止进程失败');
    }
  }, [sessionId, refresh]);

  const handleStopAll = useCallback(async () => {
    try {
      const res = await stopAllProcesses();
      notifySuccess(`已终止 ${res.killed} 个进程`);
      refresh();
    } catch (e) {
      notifyError(e, '终止全部进程失败');
    }
  }, [refresh]);

  const running = processes.filter(p => p.status === 'running');
  const exited = processes.filter(p => p.status === 'exited');

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => { setLoading(true); refresh().finally(() => setLoading(false)); }}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span className="text-xs text-muted-foreground/60">
          {running.length} 运行中 / {processes.length} 总计
        </span>
        {processes.length > 0 && (
          <button
            className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors"
            onClick={handleStopAll}
          >
            <XCircle size={12} /> 全部终止
          </button>
        )}
      </div>

      {/* 空状态 */}
      {processes.length === 0 && !loading && (
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <Terminal size={24} strokeWidth={1} className="text-muted-foreground/30" />
          <span className="text-xs">暂无后台进程</span>
          <span className="text-[10px] text-muted-foreground/50">Agent 执行后台命令时自动显示</span>
        </div>
      )}

      {/* 进程列表 */}
      <div className="flex-1 overflow-auto space-y-1 min-h-0">
        {processes.map((p) => {
          const isExpanded = expandedId === p.session_id;
          return (
            <div key={p.session_id} className="border border-[var(--ui-stroke-tertiary)] rounded-lg overflow-hidden">
              {/* 进程行 */}
              <div
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-accent/5 transition-colors',
                  p.status === 'exited' && 'opacity-50'
                )}
                onClick={() => setExpandedId(isExpanded ? null : p.session_id)}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full shrink-0',
                    p.status === 'running' ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'
                  )}
                />
                <span className="font-mono text-muted-foreground shrink-0 w-12">PID {p.pid}</span>
                <span className="flex-1 truncate text-foreground" title={p.command}>{p.command}</span>
                <span className="text-muted-foreground/60 shrink-0">{formatUptime(p.uptime_seconds)}</span>
                {p.status === 'running' && (
                  <button
                    className="shrink-0 p-0.5 rounded text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={(e) => { e.stopPropagation(); handleKill(p.session_id); }}
                    title="终止进程"
                  >
                    <Square size={12} />
                  </button>
                )}
                {p.status === 'exited' && p.exit_code != null && (
                  <span className={cn(
                    'shrink-0 text-[10px] px-1 rounded',
                    p.exit_code === 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  )}>
                    exit {p.exit_code}
                  </span>
                )}
              </div>
              {/* 展开的输出 */}
              {isExpanded && p.output_tail && (
                <pre className="px-2 py-1.5 text-[10px] leading-relaxed font-mono text-muted-foreground bg-muted/30 border-t border-[var(--ui-stroke-tertiary)] max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {p.output_tail}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
