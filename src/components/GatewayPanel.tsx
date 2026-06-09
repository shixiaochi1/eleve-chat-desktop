import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGatewayStatus } from '../utils/api';
import { Cpu, Cloud, Radio, RefreshCw } from 'lucide-react';
import { ActivityIcon, ServerIcon, UsersIcon } from './Icons';
import { cn } from '@/lib/utils';

/**
 * 格式化运行时长
 * @param {number} seconds
 * @returns {string} e.g. "2h 34m" or "45s"
 */
function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

interface GatewayStatusData {
  uptime_seconds?: number;
  platforms?: Record<string, unknown>;
  active_agents?: number;
  pid?: number;
  port?: number;
  provider?: string;
  model?: string;
}

interface GatewayPanelProps {
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  onGatewayRetry?: () => void;
  onRestart?: () => void;
}

/**
 * 网关状态面板 — 点击 Logo 显示
 * 布局：Logo → 心跳状态 → 运行时长 → 平台 → Agent → 详情 → 刷新
 */
export default function GatewayPanel({ gatewayOnline, gatewayChecking, onGatewayRetry, onRestart }: GatewayPanelProps) {
  const [status, setStatus] = useState<GatewayStatusData | null>(null);
  const [elapsed, setElapsed] = useState(0);    // 客户端计时
  const [serverUptime, setServerUptime] = useState(0); // 服务端运行时长
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // 获取服务端状态
  const fetchStatus = useCallback(async () => {
    try {
      const data: GatewayStatusData = await fetchGatewayStatus();
      if (mountedRef.current) {
        setStatus(data);
        setServerUptime(data.uptime_seconds || 0);
      }
    } catch {
      // 离线
    }
  }, []);

  // 在线时每 3s 轮询
  useEffect(() => {
    mountedRef.current = true;
    if (gatewayOnline) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 3000);
      return () => { clearInterval(interval); mountedRef.current = false; };
    } else {
      setStatus(null);
      setServerUptime(0);
      mountedRef.current = false;
    }
  }, [gatewayOnline, fetchStatus]);

  // 运行时长计时器（1s 递增）
  useEffect(() => {
    if (!gatewayOnline || !status) {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gatewayOnline, status]);

  const svgProps = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Logo */}
      <div className="flex flex-col items-center gap-1 py-2">
        <img src="/eleve_logo.png" alt="Eleve" className="w-10 h-10" />
        <span className="text-sm font-semibold text-foreground">Eleve Agent</span>
        <span className="text-[10px] text-muted-foreground/50">网关状态</span>
      </div>

      {/* 心跳状态条 */}
      <div className={cn(
        'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium',
        gatewayOnline ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'
      )}>
        <span className={cn(
          'w-2 h-2 rounded-full',
          gatewayOnline ? 'bg-green-500 animate-pulse' : 'bg-destructive'
        )} />
        <span>
          {gatewayChecking ? '检测中…' : gatewayOnline ? '网关运行中' : '网关未连接'}
        </span>
      </div>

      {/* 运行时长 */}
      {gatewayOnline && status && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground rounded border border-border">
          <ActivityIcon className="shrink-0" />
          <span className="text-muted-foreground/60">运行时长</span>
          <span className="ml-auto text-foreground font-mono">{fmtUptime(elapsed + serverUptime)}</span>
        </div>
      )}

      {/* 平台状态 */}
      {gatewayOnline && status && status.platforms && Object.keys(status.platforms).length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">平台连接</div>
          {Object.entries(status.platforms).map(([name, state]) => {
            const stateObj = typeof state === 'object' && state ? state as Record<string, unknown> : null;
            return (
            <div key={name} className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-border">
              <span className="shrink-0 text-muted-foreground"><ServerIcon /></span>
              <span className="flex-1 text-foreground">{name}</span>
              <span className={cn(
                'text-[10px]',
                stateObj?.state === 'connected' ? 'text-green-500' : 'text-destructive'
              )}>
                {stateObj?.state ? String(stateObj.state) : String(state)}
              </span>
            </div>
            );
          })}
        </div>
      )}

      {/* 活跃 Agent */}
      {gatewayOnline && status && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-border">
          <span className="shrink-0 text-muted-foreground"><UsersIcon /></span>
          <span className="text-muted-foreground/60">活跃 Agent</span>
          <span className="ml-auto text-foreground">{status.active_agents ?? '—'}</span>
        </div>
      )}

      {/* 详细信息 */}
      {gatewayOnline && status && (
        <div className="rounded border border-border divide-y divide-border">
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <span className="shrink-0 text-muted-foreground/50"><Cpu {...svgProps} /></span>
            <span className="text-muted-foreground/60">PID</span>
            <span className="ml-auto text-foreground font-mono">{status.pid || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <span className="shrink-0 text-muted-foreground/50"><Radio {...svgProps} /></span>
            <span className="text-muted-foreground/60">端口</span>
            <span className="ml-auto text-foreground font-mono">{status.port || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <span className="shrink-0 text-muted-foreground/50"><Cloud {...svgProps} /></span>
            <span className="text-muted-foreground/60">提供商</span>
            <span className="ml-auto text-foreground">{status.provider || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <span className="shrink-0 text-muted-foreground/50"><Cpu {...svgProps} /></span>
            <span className="text-muted-foreground/60">模型</span>
            <span className="ml-auto text-foreground">{status.model || '—'}</span>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex justify-center gap-2">
        {gatewayOnline && (
          <button className="p-1.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" onClick={fetchStatus} title="刷新状态">
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
        )}
        {onRestart && (
          <button className="p-1.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" onClick={onRestart} title="重启后端">
            <RefreshCw size={14} strokeWidth={1.5} className="rotate-180" />
          </button>
        )}
        {!gatewayOnline && onGatewayRetry && (
          <button className="px-3 py-1 text-xs rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50" onClick={onGatewayRetry} disabled={gatewayChecking}>
            {gatewayChecking ? '检测中…' : '重新连接'}
          </button>
        )}
      </div>

      {!gatewayOnline && (
        <div className="text-center text-[10px] text-muted-foreground/50">
          请确认 <code className="bg-muted px-1 rounded text-foreground">eleved</code> 已启动
        </div>
      )}
    </div>
  );
}
