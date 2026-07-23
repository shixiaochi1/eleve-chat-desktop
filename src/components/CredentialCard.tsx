/**
 * CredentialCard — sudo/secret 凭据输入卡片
 *
 * 用于 Agent 请求 sudo 密码或 secret/凭据值时弹出的输入框
 * 样式对齐 ClarifyCard / ApprovalCard
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
    <div className={cn(
      'mx-2 mb-2 rounded-lg border border-border bg-card p-3 shadow-sm',
      'animate-in slide-in-from-bottom-2 duration-200',
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          'flex items-center justify-center w-7 h-7 rounded-md',
          type === 'sudo' ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info',
        )}>
          <Icon size={14} />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">{title}</span>
        <button
          className="p-1 rounded text-muted-foreground hover:bg-muted/50 transition-colors"
          onClick={onDismiss}
          title="取消"
        >
          <X size={12} />
        </button>
      </div>

      {/* Description */}
      <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">{description}</p>

      {/* Input row */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type={inputType}
          className="flex-1 h-7 px-2 text-xs font-mono bg-muted/30 border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={submitting}
          autoComplete="off"
        />
        <button
          className={cn(
            'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
            value.trim() && !submitting
              ? 'bg-accent text-accent-foreground hover:bg-accent/90'
              : 'bg-muted/30 text-muted-foreground cursor-not-allowed',
          )}
          onClick={handleSubmit}
          disabled={!value.trim() || submitting}
          title="提交"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
