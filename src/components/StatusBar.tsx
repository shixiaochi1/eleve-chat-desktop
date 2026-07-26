/**
 * StatusBar — bottom status bar
 *
 * Displays connection status, model, profile, token usage, and session info
 * at the bottom of the app window.
 */
import { useState, useCallback } from 'react';
import { Circle, Copy, Check } from 'lucide-react';

interface StatusBarProps {
  connectionStatus?: string;
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  sessionId?: string;
  modelName?: string;
  profileName?: string;
  tokensIn?: number;
  tokensOut?: number;
  onOpenSettings?: () => void;
}

export default function StatusBar({
  connectionStatus = 'idle',
  gatewayOnline = false,
  gatewayChecking = false,
  sessionId = '',
  modelName,
  profileName,
  tokensIn = 0,
  tokensOut = 0,
  onOpenSettings,
}: StatusBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySession = useCallback(async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [sessionId]);

  const statusColor =
    connectionStatus === 'error' ? 'var(--error)' :
    connectionStatus === 'connected' ? 'var(--success)' :
    gatewayOnline ? 'var(--success)' :
    'var(--text-tertiary)';

  let statusText = '';
  if (connectionStatus === 'error') statusText = '连接错误';
  else if (connectionStatus === 'connected') statusText = '正在响应…';
  else if (gatewayChecking) statusText = '检测中…';
  else if (gatewayOnline) statusText = '已连接';
  else statusText = '就绪';

  const shortSessionId = sessionId ? `${sessionId.slice(0, 8)}…` : '';
  const hasSessionInfo = !!sessionId;
  const hasTokens = tokensIn > 0 || tokensOut > 0;

  return (
    <div className="h-[15px] flex items-center justify-between px-3 text-[11px] select-none shrink-0 text-accent-cyan/80">
      {/* 左侧：连接状态 + Profile */}
      <div className="flex items-center gap-1.5">
        <Circle size={8} fill={statusColor} color={statusColor} />
        <span>{statusText}</span>
        {profileName && profileName !== 'default' && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <span className="text-muted-foreground" title={`Agent: ${profileName}`}>🤖 {profileName}</span>
          </>
        )}
      </div>

      {/* 右侧：模型 + Token + Session ID */}
      <div className="flex items-center gap-3">
        {/* 当前模型 */}
        {modelName && (
          <span className="text-muted-foreground" title={`模型: ${modelName}`}>
            🧠 {modelName.length > 24 ? modelName.slice(0, 22) + '…' : modelName}
          </span>
        )}

        {/* Token 用量 */}
        {hasTokens && (
          <span className="text-muted-foreground" title={`输入 ${tokensIn.toLocaleString()} / 输出 ${tokensOut.toLocaleString()} tokens`}>
            ↑{tokensIn >= 1000 ? `${(tokensIn / 1000).toFixed(1)}k` : tokensIn} ↓{tokensOut >= 1000 ? `${(tokensOut / 1000).toFixed(1)}k` : tokensOut}
          </span>
        )}

        {/* Session ID — clickable to copy */}
        {hasSessionInfo && (
          <span
            className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
            title={`点击复制 Session ID: ${sessionId}`}
            onClick={handleCopySession}
          >
            {copied ? (
              <Check size={10} strokeWidth={2} style={{ color: 'var(--success)' }} />
            ) : (
              <Copy size={10} strokeWidth={1.5} />
            )}
            <span className="text-muted-foreground">{shortSessionId}</span>
          </span>
        )}
      </div>
    </div>
  );
}
