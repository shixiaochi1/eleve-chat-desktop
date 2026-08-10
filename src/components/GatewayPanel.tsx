import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGatewayStatus } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { RefreshCw, RotateCcw, PlugZap, Server, Cpu, Radio, Cloud, Users } from 'lucide-react';
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
  /** 🔴 2026-08-10 接线：面板内元素可跳转其它面板（SidePanel 透传） */
  onPanelChange?: (panel: string | null) => void;
}

/**
 * 网关状态面板 — 点击左侧 LOGO 打开
 *
 * 🔴 2026-08-10 整体重设计 + 全元素接线（老大要求"每一个都要接线，不能是摆设"）：
 *   Logo → 关闭面板；状态徽章/运行时长 → 点击刷新；指标卡 → 点击复制或跳转；
 *   平台徽章 → 点击复制；模型行 → 点击复制；操作按钮 → 刷新/重启/重连
 */
export default function GatewayPanel({ gatewayOnline, gatewayChecking, onGatewayRetry, onRestart, onPanelChange }: GatewayPanelProps) {
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

  const online = !!gatewayOnline;
  const platformEntries = (online && status && status.platforms && Object.keys(status.platforms).length > 0)
    ? Object.entries(status.platforms)
    : null;

  // ── 复制工具（全元素接线共用） ──
  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(`${label}已复制`);
    } catch {
      notifyError(`复制失败`);
    }
  }, []);

  const platformLabel = (name: string, state: unknown): string => {
    const stateObj = typeof state === 'object' && state ? state as Record<string, unknown> : null;
    if (stateObj?.state === 'connected') return '已连接';
    return stateObj?.state ? String(stateObj.state) : String(state);
  };
  const platformConnected = (state: unknown): boolean => {
    const stateObj = typeof state === 'object' && state ? state as Record<string, unknown> : null;
    return stateObj?.state === 'connected';
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      {/* ── Logo（点击关闭面板） ── */}
      <button
        className="group flex flex-col items-center gap-1 pt-1 outline-none"
        onClick={() => onPanelChange?.(null)}
        title="收起面板"
        aria-label="收起面板"
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-accent/20 to-accent/5 border border-border/60 flex items-center justify-center shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
          <img src="/Elogo.svg" alt="Eleve" className="w-8 h-8" />
        </div>
        <span className="text-sm font-semibold text-foreground">Eleve Agent</span>
      </button>

      {/* ── 状态徽章（点击刷新） ── */}
      <button
        className={cn(
          'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
          gatewayChecking
            ? 'bg-muted/40 border-border text-muted-foreground cursor-default'
            : online
              ? 'bg-success/10 border-success/25 text-success hover:bg-success/20 cursor-pointer'
              : 'bg-destructive/10 border-destructive/25 text-destructive hover:bg-destructive/20 cursor-pointer'
        )}
        onClick={online ? fetchStatus : undefined}
        title={online ? '点击刷新状态' : '服务未连接'}
      >
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          gatewayChecking ? 'bg-muted-foreground' : online ? 'bg-success animate-pulse' : 'bg-destructive'
        )} />
        {gatewayChecking ? '正在检测…' : online ? '网关运行中' : '网关未连接'}
      </button>

      {/* ── 运行时长（点击刷新） ── */}
      {online && status && (
        <button
          className="rounded-xl border border-border bg-gradient-to-b from-background to-muted/20 px-3 py-2.5 text-center transition-colors hover:bg-accent/30"
          onClick={fetchStatus}
          title="点击刷新状态"
        >
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">运行时长</div>
          <div className="font-mono text-2xl font-semibold text-foreground leading-tight mt-0.5">
            {fmtUptime(elapsed + serverUptime)}
          </div>
        </button>
      )}

      {/* ── 指标网格 2×2（每项可点击） ── */}
      {online && status && (
        <div className="grid grid-cols-2 gap-1.5">
          {/* 活跃 Agent → 跳转 Agent 面板 */}
          <button
            className="rounded-lg border border-border px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
            onClick={() => onPanelChange?.('agents')}
            title="查看 Agent 列表"
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 truncate">
              <Users size={10} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">活跃 Agent</span>
            </div>
            <div className="font-mono text-sm font-medium text-foreground truncate mt-0.5">
              {status.active_agents ?? '—'}
            </div>
          </button>
          {/* 端口 → 复制 */}
          <button
            className="rounded-lg border border-border px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
            onClick={() => status.port && copy(String(status.port), '端口')}
            title={status.port ? `复制端口 ${status.port}` : '端口未知'}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 truncate">
              <Radio size={10} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">端口</span>
            </div>
            <div className="font-mono text-sm font-medium text-foreground truncate mt-0.5">
              {status.port ? String(status.port) : '—'}
            </div>
          </button>
          {/* PID → 复制 */}
          <button
            className="rounded-lg border border-border px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
            onClick={() => status.pid && copy(String(status.pid), 'PID')}
            title={status.pid ? `复制 PID ${status.pid}` : 'PID 未知'}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 truncate">
              <Cpu size={10} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">PID</span>
            </div>
            <div className="font-mono text-sm font-medium text-foreground truncate mt-0.5">
              {status.pid ? String(status.pid) : '—'}
            </div>
          </button>
          {/* 提供商 → 复制 */}
          <button
            className="rounded-lg border border-border px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
            onClick={() => status.provider && copy(status.provider, '提供商')}
            title={status.provider ? `复制提供商 ${status.provider}` : '提供商未知'}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 truncate">
              <Cloud size={10} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">提供商</span>
            </div>
            <div className="font-mono text-sm font-medium text-foreground truncate mt-0.5" title={status.provider}>
              {status.provider || '—'}
            </div>
          </button>
        </div>
      )}

      {/* ── 平台连接（徽章行，点击复制平台名+状态） ── */}
      {platformEntries && (
        <div className="min-h-0 overflow-auto">
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">平台连接</div>
          <div className="flex flex-wrap gap-1.5">
            {platformEntries.map(([name, state]) => {
              const connected = platformConnected(state);
              return (
                <button
                  key={name}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] transition-colors',
                    connected
                      ? 'bg-success/10 border-success/25 text-success hover:bg-success/20'
                      : 'bg-destructive/10 border-destructive/25 text-destructive hover:bg-destructive/20'
                  )}
                  onClick={() => copy(`${name}: ${platformLabel(name, state)}`, '平台状态')}
                  title={`复制 ${name} 连接状态`}
                >
                  <Server size={9} strokeWidth={1.5} />
                  <span className="max-w-28 truncate">{name}</span>
                  <span className="opacity-70">{platformLabel(name, state)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 模型（点击复制） ── */}
      {online && status && (
        <button
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-accent/30"
          onClick={() => status.model && copy(status.model, '模型')}
          title={status.model ? `复制模型 ${status.model}` : '模型未知'}
        >
          <Cpu size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground/50" />
          <span className="text-muted-foreground/60 shrink-0">模型</span>
          <span className="ml-auto font-mono text-foreground truncate" title={status.model}>{status.model || '—'}</span>
        </button>
      )}

      {/* ── 操作区（贴底） ── */}
      <div className="mt-auto flex flex-col gap-1.5 pt-1">
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
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
