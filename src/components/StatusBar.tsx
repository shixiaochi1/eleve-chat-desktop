/**
 * StatusBar — bottom status bar
 *
 * Displays connection status, gateway status, session info,
 * token usage, and model name at the bottom of the app window.
 */
import { useState, useCallback } from 'react';
import { Circle, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  connectionStatus?: string;
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  sessionId?: string;
  tokensIn?: number;
  tokensOut?: number;
  modelName?: string;
  onOpenSettings?: () => void;
  onOpenModelPicker?: () => void;
}

export default function StatusBar({
  connectionStatus = 'idle',
  gatewayOnline = false,
  gatewayChecking = false,
  sessionId = '',
  tokensIn = 0,
  tokensOut = 0,
  modelName = '',
  onOpenSettings,
  onOpenModelPicker,
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
  const hasTokenInfo = tokensIn > 0 || tokensOut > 0;
  const hasModelInfo = !!modelName;

  return (
    <div className="h-6 bg-background flex items-center justify-between px-3 text-xs text-muted-foreground select-none shrink-0" style={{ background: 'var(--eleve-surface-backboard)' }}>
      <div className="flex items-center gap-1.5">
        <Circle
          size={8}
          fill={statusColor}
          color={statusColor}
        />
        <span>{statusText}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Model name — clickable to open model picker */}
        {hasModelInfo && (
          <span
            className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
            title={modelName}
            onClick={() => onOpenModelPicker?.()}
          >
            <span className="text-[10px] text-muted-foreground/70">Model:</span>
            <span className="text-muted-foreground">{modelName}</span>
          </span>
        )}

        {/* Token usage */}
        {hasTokenInfo && (
          <span className="flex items-center gap-1" title={`Input: ${tokensIn} · Output: ${tokensOut}`}>
            <span className="text-[10px] text-muted-foreground/70">Tokens:</span>
            <span className="text-muted-foreground">↑{tokensIn} ↓{tokensOut}</span>
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
