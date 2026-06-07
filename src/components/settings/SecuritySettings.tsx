import { Lock, Unlock } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * SecuritySettings — password protection / key vault configuration
 */
export default function SecuritySettings({
  passwordHash,
  keyUnlocked,
  onSetPassword,
}: {
  passwordHash: string;
  keyUnlocked: boolean;
  onSetPassword: () => void;
}) {
  const hasPassword = !!passwordHash;

  return (
    <div>
      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3">
        设置访问密码以保护 API Key 等敏感信息。解锁后 60 秒内可查看 Key。
      </p>

      <div className="border border-border rounded-lg p-3 bg-card">
        <div className="text-xs font-medium text-muted-foreground mb-2">密码保护状态</div>
        <div className="flex items-center gap-2">
          {hasPassword ? (
            <Lock size={14} strokeWidth={1.5} className="text-green-500 shrink-0" />
          ) : (
            <Unlock size={14} strokeWidth={1.5} className="text-muted-foreground/60 shrink-0" />
          )}
          <span className={`text-xs ${hasPassword ? 'text-green-500' : 'text-muted-foreground/60'}`}>
            {hasPassword ? '密码已设置' : '尚未设置密码'}
          </span>
        </div>
        <div className="mt-2">
          <Button variant="default" size="sm" onClick={onSetPassword} type="button">
            {hasPassword ? '更改密码' : '设置密码'}
          </Button>
        </div>
      </div>
    </div>
  );
}
