import { describe, it, expect } from 'vitest';
import { isGroupSlashCommand } from './group-slash';

describe('isGroupSlashCommand', () => {
  it('命令形状（/cmd 或 /cmd args）→ true', () => {
    expect(isGroupSlashCommand('/compress')).toBe(true);
    expect(isGroupSlashCommand('/new 话题')).toBe(true);
    expect(isGroupSlashCommand('  /resume  ')).toBe(true);
    expect(isGroupSlashCommand('/STOP')).toBe(true);
  });

  it('路径与普通文本不受影响（对齐 Hermes /etc/hosts 例）', () => {
    expect(isGroupSlashCommand('/etc/hosts')).toBe(false);
    expect(isGroupSlashCommand('/api/sessions?title=Bot Chat')).toBe(false);
    expect(isGroupSlashCommand('看 /compress')).toBe(false);
    expect(isGroupSlashCommand('https://example.com/a')).toBe(false);
    expect(isGroupSlashCommand('')).toBe(false);
  });
});
