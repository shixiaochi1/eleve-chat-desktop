/**
 * Gateway 设置 — 对齐 Hermes gateway-settings.tsx
 *
 * Local/Remote 模式切换 + 连接测试 + 双保存模式 + 日志入口
 */
import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Wifi, WifiOff, RefreshCw, TestTube, Save, Logs, AlertTriangle } from 'lucide-react';

export default function GatewaySettings() {
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [gatewayMode, setGatewayMode] = useState('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [config, setConfig] = useState<any>(null);

  // 测试连接状态
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null); // { ok, message }

  // envOverride
  const [envOverride, setEnvOverride] = useState<any>(null);

  useEffect(() => {
    checkHealth();
    loadConfig();
  }, []);

  const checkHealth = async () => {
    setChecking(true);
    try {
      await call('gateway_status', {});
      setOnline(true);
    } catch {
      setOnline(false);
    }
    setChecking(false);
  };

  const loadConfig = async () => {
    try {
      const cfg = await call('get_config', {});
      setConfig(cfg);
      if (cfg.gateway) {
        setGatewayMode(cfg.gateway.mode || 'local');
        setRemoteUrl(cfg.gateway.remote_url || '');
        setRemoteToken(cfg.gateway.remote_token || '');
      }
      // 检测 envOverride
      if (cfg.envOverride && Object.keys(cfg.envOverride).length > 0) {
        setEnvOverride(cfg.envOverride);
      } else {
        setEnvOverride(null);
      }
    } catch { /* ignore */ }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await call('test_connection', { url: remoteUrl, token: remoteToken }) as any;
      setTestResult({ ok: true, message: result?.message || '连接成功' });
      notifySuccess('连接测试成功');
    } catch (err) {
      setTestResult({ ok: false, message: (err as any)?.message || String(err) });
      notifyError(err, '连接测试失败');
    }
    setTesting(false);
  };

  const handleSaveAndReconnect = async () => {
    try {
      await call('update_config', {
        config: {
          gateway: {
            mode: gatewayMode,
            ...(gatewayMode === 'remote' ? { remote_url: remoteUrl, remote_token: remoteToken } : {}),
          },
        },
      });
      // 立即重连
      await call('reconnect_gateway', {});
      notifySuccess('Gateway 设置已保存并重连');
    } catch (err) {
      notifyError(err, '保存失败');
    }
  };

  const handleSaveLater = async () => {
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
      notifyError(err, '保存失败');
    }
  };

  const handleOpenLogs = async () => {
    try {
      await call('open_logs', {});
    } catch (err) {
      notifyError(err, '打开日志失败');
    }
  };

  const isDisabled = !!envOverride;

  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-3">
        <span className="font-medium">Gateway 连接</span>
      </div>

      {/* envOverride 警告 */}
      {envOverride && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-600 mb-3">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-xs">环境变量覆盖了网关配置，手动编辑被禁用。</span>
        </div>
      )}

      {/* 连接状态 */}
      <div className="flex items-center gap-2.5 border border-border rounded-lg p-3 bg-card mb-3">
        {online ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-500" />}
        <span className="text-xs flex-1">{online ? 'Gateway 在线' : 'Gateway 离线'}</span>
        <Button variant="ghost" size="icon-xs" onClick={checkHealth} disabled={checking} title="刷新状态">
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* 模式选择 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">连接模式</label>
        <div className="flex gap-2">
          <Button
            variant={gatewayMode === 'local' ? 'default' : 'outline'}
            size="sm"
            onClick={() => !isDisabled && setGatewayMode('local')}
            disabled={isDisabled}
          >本地模式</Button>
          <Button
            variant={gatewayMode === 'remote' ? 'default' : 'outline'}
            size="sm"
            onClick={() => !isDisabled && setGatewayMode('remote')}
            disabled={isDisabled}
          >远程模式</Button>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          {gatewayMode === 'local' ? 'Agent 在本机运行，通过子进程启动。' : '连接到远程 Gateway 服务器。'}
        </p>
      </div>

      {/* 远程配置 */}
      {gatewayMode === 'remote' && (
        <>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">远程地址</label>
            <Input
              className="h-8 text-xs"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://your-gateway.example.com"
              disabled={isDisabled}
            />
            <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">远程 Gateway 的完整 URL。</p>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">访问令牌</label>
            <Input
              className="h-8 text-xs"
              type="password"
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
              placeholder="输入令牌…"
              disabled={isDisabled}
            />
            <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">用于认证远程 Gateway 连接。</p>
          </div>

          {/* 测试连接按钮 */}
          {!isDisabled && (
            <div className="mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || !remoteUrl.trim()}
                className="inline-flex items-center gap-1.5"
              >
                <TestTube size={14} />
                {testing ? '测试中…' : '测试连接'}
              </Button>
              {testResult && (
                <span className={`ml-2 text-[11px] ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* 双保存模式 */}
      {!isDisabled && (
        <div className="flex gap-2 mt-4 pt-4 border-t border-border">
          <Button variant="default" size="sm" className="flex-1" onClick={handleSaveAndReconnect}>
            <Save size={14} /> 保存并重连
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleSaveLater}>
            <Save size={14} /> 保存下次重启
          </Button>
        </div>
      )}

      {/* Diagnostics 日志入口 */}
      <div className="mt-4 text-center">
        <Button variant="ghost" size="sm" onClick={handleOpenLogs}>
          <Logs size={14} /> 打开日志
        </Button>
      </div>
    </div>
  );
}
