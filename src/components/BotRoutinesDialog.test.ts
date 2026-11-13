/**
 * Bot Routines 的归属判据（对齐 Hermes `plugins/hermes-bots/cron.tsx`）：
 * - 任务名命名空间 `[bot:<profile>] <title>`；
 * - `cron.manage` 回执带 `scoped` = 服务端按该 profile 取库（整份都属于它）；
 *   缺省/不匹配时回落到标签过滤（旧网关兼容）。
 */
import { describe, expect, it } from 'vitest';

import { routineBotTag, routineTitle, selectRoutineJobs } from './BotRoutinesDialog';

describe('bot routines attribution', () => {
  it('strips the namespace for display', () => {
    expect(routineTitle('[bot:coder] 每日简报', 'coder')).toBe('每日简报');
    // 其它 bot 的标签同样剥掉（面板只显示标题本身）
    expect(routineTitle('[bot:writer] 别人的例程', 'coder')).toBe('别人的例程');
    expect(routineTitle('无标签任务', 'coder')).toBe('无标签任务');
    expect(routineTitle('[bot:coder]', 'coder')).toBe('未命名例程');
    expect(routineTitle(undefined, 'coder')).toBe('未命名例程');
  });

  it('tags are case-insensitive', () => {
    expect(routineBotTag('Coder')).toBe('[bot:coder]');
    expect(routineTitle('[BOT:Coder]  大小写', 'coder')).toBe('大小写');
  });

  it('trusts scoped lists and filters unscoped ones', () => {
    const jobs = [
      { job_id: '1', name: '[bot:coder] A' },
      { job_id: '2', name: '[bot:writer] B' },
      { job_id: '3', name: 'legacy' },
    ];
    // scoped == 当前 bot → 整份列表都属于它（含未加标签的历史任务）
    expect(selectRoutineJobs({ jobs, scoped: 'Coder' }, 'coder').map((j) => j.job_id)).toEqual([
      '1',
      '2',
      '3',
    ]);
    // 无 scoped（旧网关）→ 只认 `[bot:coder]` 标签
    expect(selectRoutineJobs({ jobs }, 'coder').map((j) => j.job_id)).toEqual(['1']);
    // scoped 指向别的 profile → 不能信，回落标签过滤
    expect(selectRoutineJobs({ jobs, scoped: 'writer' }, 'coder').map((j) => j.job_id)).toEqual([
      '1',
    ]);
    // 空回执
    expect(selectRoutineJobs(undefined, 'coder')).toEqual([]);
  });
});
