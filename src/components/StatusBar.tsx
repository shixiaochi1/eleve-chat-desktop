/**
 * StatusBar — bottom status bar
 *
 * Displays connection status, gateway status, and session info
 * at the bottom of the app window.
 */
import { useState, useCallback } from 'react';
import { Circle, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  connectionStatus?: string;
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  sessionId?: string;
  onOpenSettings?: () => void;
}

export default function StatusBar({
  connectionStatus = 'idle',
  gatewayOnline = false,
  gatewayChecking = false,
  sessionId = '',
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

  // Truncate session ID for display
  const shortSessionId = sessionId ? `${sessionId.slice(0, 8)}…` : '';
  const hasSessionInfo = !!sessionId;

  return (
    <div className="h-[15px] flex items-center justify-between px-3 text-[11px] select-none shrink-0" style={{ background: 'transparent', color: 'rgba(125, 211, 252, 0.8)' }}>
      <div className="flex items-center gap-1.5">
        <Circle
          size={8}
          fill={statusColor}
          color={statusColor}
        />
        <span>{statusText}</span>
      </div>

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
