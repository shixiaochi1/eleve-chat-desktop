import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { verifyPassword, hashPassword } from '../utils/crypto';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PasswordDialogProps {
  mode: 'create' | 'unlock';
  storedHash?: string;
  onSuccess?: (hash?: string) => void;
  onCancel?: () => void;
}

/**
 * 密码对话框 — 创建密码 / 解锁两种模式
 * 
 * Props:
 *   mode:      'create' | 'unlock'
 *   storedHash: 已存储的密码 hash（unlock 模式用）
 *   onSuccess:  密码正确/创建成功时回调
 *   onCancel:   取消回调
 */
export default function PasswordDialog({ mode, storedHash, onSuccess, onCancel }: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isCreate = mode === 'create';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    if (isCreate) {
      if (password.length < 4) {
        setError('密码至少 4 位');
        return;
      }
      if (password !== confirm) {
        setError('两次密码不一致');
        return;
      }
      setChecking(true);
      const hash = await hashPassword(password);
      setChecking(false);
      onSuccess?.(hash);
    } else {
      setChecking(true);
      const ok = await verifyPassword(password, storedHash || '');
      setChecking(false);
      if (ok) {
        onSuccess?.();
      } else {
        setError('密码错误');
        setPassword('');
      }
    }
  };

  const inputClasses =
    'desktop-input-chrome h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

    // @ts-ignore
  return (
    <Dialog onOpenChange={(open: boolean) => { if (!open) onCancel?.(); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
      >
        <DialogTitle className="text-base">
          {isCreate ? '创建设置密码' : '输入密码查看 API Key'}
        </DialogTitle>
        <DialogDescription>
          {isCreate
            ? '密码用于保护 API Key 的显示。请牢记此密码。'
            : '请输入设置密码以临时查看 API Key（60 秒后自动隐藏）'}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            type="password"
            className={inputClasses}
            placeholder={isCreate ? '输入密码（至少 4 位）' : '输入设置密码'}
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoComplete="new-password"
            data-slot="input"
          />
          {isCreate && (
            <Input
              type="password"
              placeholder="确认密码"
              value={confirm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={checking}>
              {checking ? '验证中…' : isCreate ? '创建' : '解锁'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
