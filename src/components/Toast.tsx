/**
 * Toast 通知组件 — 对齐 Hermes components/notifications.tsx
 *
 * Apple macOS 风格：
 *  - 毛玻璃背景 + 阴影
 *  - 4 种类型：error(红) / warning(黄) / info(蓝) / success(绿)
 *  - 最多堆叠 4 条，溢出显示"查看更多"
 *  - error/warning 手动关闭，info/success 5s 自动消失
 *  - 可展开详情 + 操作按钮
 */
import { useState, useRef, useEffect } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useNotifications, dismissNotification, clearNotifications } from '../utils/notifications';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  kind: string;
  title?: string;
  message?: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastItemProps {
  notification: Notification;
}

const KIND_STYLE: Record<string, { icon: React.ComponentType<any>; color: string; borderClass: string }> = {
  error:   { icon: AlertCircle,    color: 'var(--ui-red)', borderClass: 'border-l-red-500' },
  warning: { icon: AlertTriangle,  color: 'var(--ui-yellow)', borderClass: 'border-l-yellow-500' },
  info:    { icon: Info,           color: 'var(--ui-blue)', borderClass: 'border-l-blue-500' },
  success: { icon: CheckCircle,    color: 'var(--ui-green)', borderClass: 'border-l-green-500' },
};

export default function Toast() {
  const notifications: Notification[] = useNotifications();
  const [expanded, setExpanded] = useState(false);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (notifications.length <= 1) setExpanded(false);
  }, [notifications.length]);

  // 新通知时收起
  useEffect(() => {
    const latest = notifications[0];
    if (latest && latest.id !== lastIdRef.current) {
      lastIdRef.current = latest.id;
    }
  }, [notifications]);

  if (notifications.length === 0) return null;

  const [latest, ...older] = notifications;
  const overflow = older.length;

  return (
    <div
      className="fixed z-[9999] flex flex-col gap-2 pointer-events-none"
      style={{
        top: 'calc(var(--titlebar-h, 32px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(420px, calc(100% - 2rem))',
      }}
    >
      <ToastItem notification={latest} />

      {expanded && older.map((n) => <ToastItem key={n.id} notification={n} />)}

      {overflow > 0 && (
        <div
          className={cn(
            'flex items-center justify-between px-3 py-1.5 pointer-events-auto',
            'backdrop-blur-xl saturate-180 border rounded-xl',
            'border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.12)]'
          )}
          style={{
            background: 'var(--ui-bg-elevated)',
            fontSize: 12,
            color: 'var(--ui-text-tertiary)',
          }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            className="bg-transparent border-none cursor-pointer font-medium"
            style={{ color: 'var(--ui-text-primary)', font: 'inherit', padding: 0 }}
          >
            {expanded ? '收起' : '查看'} {overflow} 条通知
          </button>
          <button
            onClick={clearNotifications}
            className="bg-transparent border-none cursor-pointer"
            style={{ color: 'var(--ui-text-tertiary)', font: 'inherit', padding: 0 }}
          >
            全部清除
          </button>
        </div>
      )}
    </div>
  );
}

function ToastItem({ notification }: ToastItemProps) {
  const style = KIND_STYLE[notification.kind] || KIND_STYLE.info;
  const Icon = style.icon;
  const hasDetail = Boolean(notification.detail && notification.detail !== notification.message);
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div
      role={notification.kind === 'error' ? 'alert' : 'status'}
      aria-live={notification.kind === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto grid items-start p-2.5 rounded-xl',
        'backdrop-blur-xl saturate-180 border shadow-[0_8px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.12)]',
        style.borderClass || 'border-white/10',
        'border-l-[3px]'
      )}
      style={{
        background: 'var(--ui-bg-elevated)',
        gridTemplateColumns: 'auto 1fr auto',
        gap: '0 10px',
        animation: 'toast-in 0.25s ease-out',
        borderLeftColor: style.color,
      }}
    >
      {/* 图标 */}
      <Icon size={18} style={{ color: style.color, marginTop: 1, flexShrink: 0 }} />

      {/* 内容 */}
      <div className="min-w-0">
        {notification.title && (
          <div className="font-semibold mb-0.5" style={{ fontSize: 13, color: 'var(--ui-text-primary)' }}>
            {notification.title}
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--ui-text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {notification.message}
        </div>

        {/* 详情折叠 */}
        {hasDetail && (
          <div className="mt-1">
            <button
              onClick={() => setDetailOpen((v) => !v)}
              className="bg-transparent border-none cursor-pointer flex items-center gap-1 p-0"
              style={{
                font: 'inherit',
                color: 'var(--ui-text-tertiary)',
                fontSize: 11,
              }}
            >
              {detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              详情
            </button>
            {detailOpen && (
              <pre
                className="mt-1 p-2 rounded-md whitespace-pre-wrap break-words overflow-y-auto"
                style={{
                  margin: '4px 0 0',
                  fontSize: 11,
                  lineHeight: 1.4,
                  background: 'var(--ui-bg-primary)',
                  color: 'var(--ui-text-tertiary)',
                  maxHeight: 120,
                }}
              >
                {notification.detail}
              </pre>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        {notification.action && (
          <button
            onClick={() => { notification.action!.onClick(); dismissNotification(notification.id); }}
            className="mt-1.5 px-2.5 py-1 rounded-md cursor-pointer text-xs font-medium border transition-[background] duration-150"
            style={{
              background: `${style.color}22`,
              color: style.color,
              borderColor: `${style.color}44`,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = `${style.color}33`; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = `${style.color}22`; }}
          >
            {notification.action.label}
          </button>
        )}
      </div>

      {/* 关闭按钮 */}
      <button
        aria-label="关闭通知"
        onClick={() => dismissNotification(notification.id)}
        className="bg-transparent border-none cursor-pointer grid place-items-center rounded p-0.5 transition-[color,background] duration-150"
        style={{
          color: 'var(--ui-text-tertiary)',
          width: 24,
          height: 24,
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = 'var(--ui-text-primary)'; e.currentTarget.style.background = 'var(--ui-bg-tertiary)'; }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = 'var(--ui-text-tertiary)'; e.currentTarget.style.background = 'none'; }}
      >
        <X size={14} />
      </button>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
