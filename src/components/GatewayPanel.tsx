import { useState, useEffect, useCallback, useRef } from 'react';
import { call, restartService } from '../utils/bridge';
import { fetchGatewayStatus } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { Button } from './ui/button';
import { Input } from './ui/input';
import LogsPanel from './LogsPanel';
import {
  RefreshCw, RotateCcw, PlugZap, Server, Cpu, Radio, Cloud, Users,
  Wifi, WifiOff, TestTube, Save, Logs, AlertTriangle,
} from 'lucide-react';
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
 * 🔴 2026-08-10 重设计 + 全元素接线 + 设置合并：
 * - 仪表盘式布局（Logo/状态徽章/运行时长/指标网格/平台/模型），每元素可交互
 * - 🔴 整合原设置「网关」section（GatewaySettings 已移除）：
 *   连接模式（本地/远程）、远程地址/令牌、测试连接、保存并重连/保存稍后、
 *   envOverride 警告、打开日志 —— LOGO 面板 = 网关功能唯一入口
 */
export default function GatewayPanel({ gatewayOnline, gatewayChecking, onGatewayRetry, onRestart, onPanelChange }: GatewayPanelProps) {
  // ── 状态概览（仪表盘） ──
  const [status, setStatus] = useState<GatewayStatusData | null>(null);
  const [elapsed, setElapsed] = useState(0);    // 客户端计时
  const [serverUptime, setServerUptime] = useState(0); // 服务端运行时长
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── 配置（原设置「网关」section 搬入） ──
  const [gatewayMode, setGatewayMode] = useState('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [config, setConfig] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [envOverride, setEnvOverride] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  // 🔴 2026-08-10 日志视图开关（原左侧工具栏「日志」按钮搬入，open_logs 外部目录版废弃）
  const [logsVisible, setLogsVisible] = useState(false);

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

  // 加载网关配置（模式/远程地址/令牌/envOverride）
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await call('get_config', {});
      setConfig(cfg);
      if (cfg?.gateway) {
        setGatewayMode(cfg.gateway.mode || 'local');
        setRemoteUrl(cfg.gateway.remote_url || '');
        setRemoteToken(cfg.gateway.remote_token || '');
      }
      if (cfg?.envOverride && Object.keys(cfg.envOverride).length > 0) {
        setEnvOverride(cfg.envOverride);
      } else {
        setEnvOverride(null);
      }
    } catch { /* ignore */ }
  }, []);

  // 在线时每 3s 轮询状态 + 加载配置
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

  // 配置一次性加载
  useEffect(() => { loadConfig(); }, [loadConfig]);

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
  const isDisabled = !!envOverride;

  // ── 复制工具（全元素接线共用） ──
  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(`${label}已复制`);
    } catch (err) {
      notifyError(err, '复制失败');
    }
  }, []);

  // ── 配置操作（原 GatewaySettings 搬入） ──
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await call('test_connection', { url: remoteUrl, token: remoteToken }) as any;
      setTestResult({ ok: true, message: result?.message || '连接成功' });
      notifySuccess('连接测试成功');
    } catch (err) {
      setTestResult({ ok: false, message: (err as any)?.message || String(err) });
      notifyError(err as Error, '连接测试失败');
    }
    setTesting(false);
  };

  const handleSaveAndReconnect = async () => {
    setSaving(true);
    try {
      await call('update_config', {
        config: {
          gateway: {
            mode: gatewayMode,
            ...(gatewayMode === 'remote' ? { remote_url: remoteUrl, remote_token: remoteToken } : {}),
          },
        },
      });
      await restartService();
      notifySuccess('Gateway 设置已保存并重连');
    } catch (err) {
      notifyError(err as Error, '保存失败');
    }
    setSaving(false);
  };

  const handleSaveLater = async () => {
    setSaving(true);
    try {
      await call('update_config', {
        config: {
          gateway: {
            mode: gatewayMode,
            ...(gatewayMode === 'remote' ? { remote_url: remoteUrl, remote_token: remoteToken } : {}),
          },
        },
      });
      notifySuccess('Gateway 设置已保存，下次重启生效');
    } catch (err) {
      notifyError(err as Error, '保存失败');
    }
    setSaving(false);
  };

  const handleOpenLogs = () => {
    // 🔴 2026-08-10 搬入 LogsPanel（左侧工具栏「日志」按钮同款真实尾随面板），
    // 废弃 call('open_logs') 外部目录版（老大反馈：假功能）
    setLogsVisible(true);
  };

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
    <div className="flex flex-col h-full p-3 gap-2.5 overflow-hidden">
      {/* ── Logo（点击关闭面板） ── */}
      <button
        className="group flex flex-col items-center gap-1 pt-0.5 outline-none shrink-0"
        onClick={() => onPanelChange?.(null)}
        title="收起面板"
        aria-label="收起面板"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-b from-accent/20 to-accent/5 border border-[var(--ui-stroke-tertiary)] flex items-center justify-center shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
          <img src="/Elogo.svg" alt="Eleve" className="w-7 h-7" />
        </div>
        <span className="text-sm font-semibold text-foreground">Eleve Agent</span>
      </button>

      {/* ── 状态徽章（点击刷新） ── */}
      <button
        className={cn(
          'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors shrink-0',
          gatewayChecking
            ? 'bg-muted/40 border-[var(--ui-stroke-tertiary)] text-muted-foreground cursor-default'
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
          className="rounded-xl border border-[var(--ui-stroke-tertiary)] bg-gradient-to-b from-background to-muted/20 px-3 py-2 text-center transition-colors hover:bg-accent/30 shrink-0"
          onClick={fetchStatus}
          title="点击刷新状态"
        >
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">运行时长</div>
          <div className="font-mono text-xl font-semibold text-foreground leading-tight mt-0.5">
            {fmtUptime(elapsed + serverUptime)}
          </div>
        </button>
      )}

      {/* ── 指标网格 2×2（每项可点击） ── */}
      {online && status && (
        <div className="grid grid-cols-2 gap-1.5 shrink-0">
          <button
            className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
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
          <button
            className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
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
          <button
            className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
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
          <button
            className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-2 py-1.5 min-w-0 text-left transition-colors hover:bg-accent/30"
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

      {/* ── 平台连接（徽章行，点击复制） ── */}
      {platformEntries && (
        <div className="min-h-0 shrink-0">
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
          className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-accent/30 shrink-0"
          onClick={() => status.model && copy(status.model, '模型')}
          title={status.model ? `复制模型 ${status.model}` : '模型未知'}
        >
          <Cpu size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground/50" />
          <span className="text-muted-foreground/60 shrink-0">模型</span>
          <span className="ml-auto font-mono text-foreground truncate" title={status.model}>{status.model || '—'}</span>
        </button>
      )}

      {/* ── 配置区 / 日志区（二选一，可滚动） ── */}
      {logsVisible ? (
        /* 🔴 2026-08-10 日志视图：左侧工具栏 LogsPanel 搬入（5s 轮询尾随、三文件切换、暂停） */
        <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-[var(--ui-stroke-tertiary)] bg-muted/10 flex flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--ui-stroke-tertiary)] px-2 py-1">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">运行日志</span>
            <button
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              onClick={() => setLogsVisible(false)}
              title="返回连接配置"
            >
              ← 返回配置
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <LogsPanel />
          </div>
        </div>
      ) : (
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[var(--ui-stroke-tertiary)] bg-muted/10 px-2.5 py-2 space-y-2.5">
        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">连接配置</div>

        {envOverride && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5">
            <AlertTriangle size={13} className="shrink-0 text-warning" />
            <span className="text-[11px] text-warning">环境变量覆盖了网关配置，手动编辑被禁用。</span>
          </div>
        )}

        {/* 连接模式 */}
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">连接模式</label>
          <div className="flex gap-1.5">
            <Button
              variant={gatewayMode === 'local' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => !isDisabled && setGatewayMode('local')}
              disabled={isDisabled}
            >本地模式</Button>
            <Button
              variant={gatewayMode === 'remote' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => !isDisabled && setGatewayMode('remote')}
              disabled={isDisabled}
            >远程模式</Button>
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-1">
            {gatewayMode === 'local' ? 'Agent 在本机运行，通过子进程启动。' : '连接到远程 Gateway 服务器。'}
          </p>
        </div>

        {/* 远程配置 */}
        {gatewayMode === 'remote' && (
          <>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">远程地址</label>
              <Input
                className="h-7 text-xs"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://your-gateway.example.com"
                disabled={isDisabled}
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">访问令牌</label>
              <Input
                className="h-7 text-xs"
                type="password"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder="输入令牌…"
                disabled={isDisabled}
              />
            </div>
            {!isDisabled && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1.5 text-xs"
                  onClick={handleTestConnection}
                  disabled={testing || !remoteUrl.trim()}
                >
                  <TestTube size={12} />
                  {testing ? '测试中…' : '测试连接'}
                </Button>
                {testResult && (
                  <span className={`ml-2 text-[11px] ${testResult.ok ? 'text-success' : 'text-destructive'}`}>
                    {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* 保存 */}
        {!isDisabled && (
          <div className="flex gap-1.5 pt-1">
            <Button variant="default" size="sm" className="flex-1 text-xs" onClick={handleSaveAndReconnect} disabled={saving}>
              <Save size={12} /> 保存并重连
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleSaveLater} disabled={saving}>
              <Save size={12} /> 保存稍后
            </Button>
          </div>
        )}

        {/* 日志 */}
        <div className="text-center">
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleOpenLogs}>
            <Logs size={12} /> 打开日志
          </Button>
        </div>
      </div>
      )}

      {/* ── 操作区（贴底） ── */}
      <div className="flex flex-col gap-1.5 pt-0.5 shrink-0">
        {online && (
          <div className="flex gap-1.5">
            <button
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
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
