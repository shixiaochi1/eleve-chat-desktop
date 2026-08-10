import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGatewayStatus } from '../utils/api';
import { Cpu, Cloud, Radio, RefreshCw, RotateCcw, PlugZap } from 'lucide-react';
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
 *
 * 🔴 2026-08-10 重设计（老大反馈：刷新/重启按钮图标雷同 + 布局松散）：
 * - 三个操作按钮图标+文字双标识：刷新=RefreshCw（ghost）、重启=RotateCcw（警示红）、
 *   重连=PlugZap（主色），杜绝"看起来一样"
 * - 信息区统一 divide 卡片风格（运行时长/活跃 Agent 合并一张，平台列表同款）
 * - Logo 加在线状态角标，操作区 mt-auto 贴底，结构清晰
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
  const online = !!gatewayOnline;
  const platforms = (gatewayOnline && status && status.platforms && Object.keys(status.platforms).length > 0)
    ? Object.entries(status.platforms)
    : null;

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* ── Logo 区（含在线状态角标） ── */}
      <div className="flex flex-col items-center gap-1.5 pt-1 pb-1">
        <div className="relative">
          <img src="/Elogo.svg" alt="Eleve" className="w-12 h-12 rounded-xl shadow-sm" />
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background',
              online ? 'bg-success' : 'bg-destructive'
            )}
          />
        </div>
        <span className="text-sm font-semibold text-foreground">Eleve Agent</span>
        <span className={cn(
          'text-[10px]',
          gatewayChecking ? 'text-muted-foreground/60' : online ? 'text-success/80' : 'text-destructive/80'
        )}>
          {gatewayChecking ? '正在检测…' : online ? '服务运行中' : '服务未连接'}
        </span>
      </div>

      {/* ── 状态卡：运行时长 + 活跃 Agent（统一 divide 卡） ── */}
      {online && status && (
        <div className="rounded-lg border border-border divide-y divide-border text-xs overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <ActivityIcon className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">运行时长</span>
            <span className="ml-auto font-mono text-foreground">{fmtUptime(elapsed + serverUptime)}</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UsersIcon className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">活跃 Agent</span>
            <span className="ml-auto font-mono text-foreground">{status.active_agents ?? '—'}</span>
          </div>
        </div>
      )}

      {/* ── 平台连接（同款卡片） ── */}
      {platforms && (
        <div className="space-y-1 min-h-0 overflow-auto">
          <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide px-0.5">平台连接</div>
          <div className="rounded-lg border border-border divide-y divide-border text-xs overflow-hidden">
            {platforms.map(([name, state]) => {
              const stateObj = typeof state === 'object' && state ? state as Record<string, unknown> : null;
              const connected = stateObj?.state === 'connected';
              return (
                <div key={name} className="flex items-center gap-2 px-2.5 py-1.5">
                  <ServerIcon className="shrink-0 text-muted-foreground/50" />
                  <span className="flex-1 text-foreground truncate">{name}</span>
                  <span className={cn('text-[10px] font-medium', connected ? 'text-success' : 'text-destructive')}>
                    {connected ? '已连接' : (stateObj?.state ? String(stateObj.state) : String(state))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 详情卡：PID / 端口 / 提供商 / 模型 ── */}
      {online && status && (
        <div className="rounded-lg border border-border divide-y divide-border text-xs overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Cpu {...svgProps} className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">PID</span>
            <span className="ml-auto font-mono text-foreground">{status.pid || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Radio {...svgProps} className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">端口</span>
            <span className="ml-auto font-mono text-foreground">{status.port || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Cloud {...svgProps} className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">提供商</span>
            <span className="ml-auto text-foreground truncate">{status.provider || '—'}</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Cpu {...svgProps} className="shrink-0 text-muted-foreground/50" />
            <span className="text-muted-foreground/60">模型</span>
            <span className="ml-auto text-foreground truncate">{status.model || '—'}</span>
          </div>
        </div>
      )}

      {/* ── 操作区（贴底）：刷新 / 重启后端 / 重新连接 ── */}
      <div className="mt-auto pt-1 flex flex-col gap-1.5">
        {online && (
          <div className="flex gap-1.5">
            <button
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              onClick={fetchStatus}
              title="刷新状态"
            >
              <RefreshCw size={12} strokeWidth={1.5} />
              <span>刷新</span>
            </button>
            {onRestart && (
              <button
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-destructive/25 text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={onRestart}
                title="重启后端服务"
              >
                <RotateCcw size={12} strokeWidth={1.5} />
                <span>重启</span>
              </button>
            )}
          </div>
        )}
        {!online && onGatewayRetry && (
          <button
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onGatewayRetry}
            disabled={gatewayChecking}
            title="重新检测网关连接"
          >
            <PlugZap size={12} strokeWidth={1.5} />
            <span>{gatewayChecking ? '检测中…' : '重新连接'}</span>
          </button>
        )}
        {!online && (
          <div className="text-center text-[10px] text-muted-foreground/50">
            请确认 <code className="bg-muted px-1 rounded text-foreground">eleved</code> 已启动
          </div>
        )}
      </div>
    </div>
  );
}
