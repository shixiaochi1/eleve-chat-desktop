import { Lock } from 'lucide-react';
import { Button } from '../ui/button';
import { SectionCard, SettingRow } from './SettingBlocks';

/**
 * SecuritySettings — password protection / key vault configuration
 *
 * 2026-08-31 卡片 UI 重构：自制小卡片 → 统一 SectionCard（逻辑不变）。
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
    <div className="max-w-2xl">
      <SectionCard
        icon={Lock}
        title="密码保护"
        desc="设置访问密码以保护 API Key 等敏感信息。解锁后 60 秒内可查看 Key。"
      >
        <SettingRow
          label="密码保护状态"
          desc={hasPassword ? '已设置密码，敏感信息处于保护中' : '尚未设置密码'}
        >
          <Button variant="default" size="sm" onClick={onSetPassword} type="button">
            {hasPassword ? '更改密码' : '设置密码'}
          </Button>
        </SettingRow>
      </SectionCard>
    </div>
  );
}
