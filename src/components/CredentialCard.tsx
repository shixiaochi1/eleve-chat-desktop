/**
 * CredentialCard — sudo/secret 凭据输入卡片（中断型交互卡片家族 · secret 变体）
 *
 * 用于 Agent 请求 sudo 密码或 secret/凭据值时弹出的输入框
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Shield, KeyRound, X, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CredentialCardProps {
  type: 'sudo' | 'secret';
  title: string;
  description: string;
  onSubmit: (value: string) => Promise<void>;
  onDismiss: () => void;
}

export default function CredentialCard({ type, title, description, onSubmit, onDismiss }: CredentialCardProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 自动聚焦输入框
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setSubmitting(false);
    }
  }, [value, submitting, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onDismiss();
    }
  }, [handleSubmit, onDismiss]);

  const Icon = type === 'sudo' ? Shield : KeyRound;
  const inputType = type === 'sudo' ? 'password' : 'text';
  const placeholder = type === 'sudo' ? '输入 sudo 密码…' : '输入凭据值…';

  return (
    <div className="icard icard--secret">
      {/* 头部 */}
      <div className="icard-head">
        <div className="icard-icon">
          <Icon size={14} strokeWidth={2} />
        </div>
        <span className="icard-title">{title}</span>
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDismiss}
          title="取消 (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      <div className="icard-body">
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-2.5">{description}</p>

        {/* 输入行 */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type={inputType}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 font-mono text-xs text-foreground outline-none transition-all',
              'placeholder:text-muted-foreground/40',
              'focus:border-accent-purple/50 focus:bg-accent-purple/5 focus:ring-2 focus:ring-accent-purple/15',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={submitting}
            autoComplete="off"
          />
          <button
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg transition-all',
              value.trim() && !submitting
                ? 'bg-accent-purple text-background shadow-sm hover:brightness-110 hover:-translate-y-px active:scale-95'
                : 'bg-card text-muted-foreground/40 cursor-not-allowed'
            )}
            onClick={handleSubmit}
            disabled={!value.trim() || submitting}
            title="提交 (Enter)"
          >
            {submitting ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send size={13} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
