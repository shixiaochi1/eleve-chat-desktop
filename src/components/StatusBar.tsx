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
  profileName?: string;
  onOpenSettings?: () => void;
}

export default function StatusBar({
  connectionStatus = 'idle',
  gatewayOnline = false,
  gatewayChecking = false,
  sessionId = '',
  profileName,
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

  return (
    <div className="h-[15px] flex items-center justify-between px-3 text-[11px] select-none shrink-0" style={{ color: `var(--theme-primary)` }}>
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

      {/* 右侧：Session ID — clickable to copy（🔴 2026-08-02：模型名/token 已由 ContextBar（输入框上方）统一展示，此处删除防重复） */}
      <div className="flex items-center gap-3">
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
