import { describe, it, expect } from 'vitest';
import {
  applyDraft,
  draftFromEntry,
  isDraftDirty,
  parseList,
  EMPTY_DRAFT,
  DEFAULTS,
} from './mcp-server-config';
import type { AdvancedDraft } from './mcp-server-config';

const base = {
  command: 'npx',
  args: ['-y', '@x/server'],
  env: { TOKEN: 'x' },
  enabled: true,
};

describe('parseList', () => {
  it('支持中英文逗号与空白，并去重', () => {
    expect(parseList('a, b，b  c')).toEqual(['a', 'b', 'c']);
  });

  it('空串得到空数组', () => {
    expect(parseList('   ')).toEqual([]);
  });
});

describe('draftFromEntry', () => {
  it('缺失字段回落到默认值', () => {
    const draft = draftFromEntry(base);
    expect(draft.lazy).toBe(false);
    expect(draft.samplingEnabled).toBe(false);
    expect(draft.samplingMaxRequests).toBe(String(DEFAULTS.samplingMaxRequests));
    expect(draft.elicitationTimeout).toBe(String(DEFAULTS.elicitationTimeout));
  });

  it('读出现有配置', () => {
    const draft = draftFromEntry({
      ...base,
      lazy: true,
      idle_timeout: 600,
      include_tools: ['a', 'b'],
      sampling: { enabled: true, model: 'gpt-x', max_requests: 5, max_tokens: 128, timeout_secs: 10 },
      elicitation: { enabled: true, timeout_secs: 60 },
    });
    expect(draft.lazy).toBe(true);
    expect(draft.idleTimeout).toBe('600');
    expect(draft.include).toBe('a, b');
    expect(draft.samplingEnabled).toBe(true);
    expect(draft.samplingModel).toBe('gpt-x');
    expect(draft.samplingMaxRequests).toBe('5');
    expect(draft.elicitationEnabled).toBe(true);
    expect(draft.elicitationTimeout).toBe('60');
  });
});

describe('applyDraft', () => {
  it('保留表单不展示的连接字段', () => {
    const next = applyDraft(base, { ...EMPTY_DRAFT, lazy: true });
    expect(next.command).toBe('npx');
    expect(next.args).toEqual(['-y', '@x/server']);
    expect(next.env).toEqual({ TOKEN: 'x' });
    expect(next.lazy).toBe(true);
  });

  it('关闭的开关删键而不是写空值', () => {
    const next = applyDraft(
      { ...base, lazy: true, idle_timeout: 60, include_tools: ['a'], sampling: { enabled: true } },
      EMPTY_DRAFT,
    );
    expect(next.lazy).toBeUndefined();
    expect(next.idle_timeout).toBeUndefined();
    expect(next.include_tools).toBeUndefined();
    expect(next.sampling).toBeUndefined();
    // 不写 `idle_timeout: 0`：0 的语义是"永不回收"，和"没配置"不是一回事
    expect('idle_timeout' in next).toBe(false);
  });

  it('数字非法时回落到默认值而非 NaN', () => {
    const draft: AdvancedDraft = {
      ...EMPTY_DRAFT,
      samplingEnabled: true,
      samplingMaxRequests: 'abc',
      samplingMaxTokens: '',
      samplingTimeout: '-5',
    };
    const next = applyDraft(base, draft);
    expect(next.sampling.max_requests).toBe(DEFAULTS.samplingMaxRequests);
    expect(next.sampling.max_tokens).toBe(DEFAULTS.samplingMaxTokens);
    expect(next.sampling.timeout_secs).toBe(DEFAULTS.samplingTimeout);
  });

  it('开启 sampling 时不写空 model', () => {
    const next = applyDraft(base, { ...EMPTY_DRAFT, samplingEnabled: true, samplingModel: '  ' });
    expect(next.sampling.enabled).toBe(true);
    expect('model' in next.sampling).toBe(false);
  });

  it('include/exclude 解析成数组并去重', () => {
    const next = applyDraft(base, { ...EMPTY_DRAFT, include: 'a,b', exclude: 'c, c' });
    expect(next.include_tools).toEqual(['a', 'b']);
    expect(next.exclude_tools).toEqual(['c']);
  });
});

describe('嵌套 tools 过滤器（Hermes 迁移形态）', () => {
  const nested = { ...base, tools: { include: ['read_*'], exclude: ['delete_*'] } };

  it('读取时优先嵌套（否则表单一律显示为空）', () => {
    const draft = draftFromEntry(nested);
    expect(draft.include).toBe('read_*');
    expect(draft.exclude).toBe('delete_*');
  });

  it('保存时写回嵌套，不留下会被忽略的扁平键', () => {
    const draft = { ...draftFromEntry(nested), include: 'read_*, list_*', exclude: '' };
    const next = applyDraft(nested, draft);
    expect(next.tools).toEqual({ include: ['read_*', 'list_*'] });
    expect(next.include_tools).toBeUndefined();
    expect(next.exclude_tools).toBeUndefined();
  });

  it('嵌套被清空时删掉整个 tools 段', () => {
    const draft = { ...draftFromEntry(nested), include: '', exclude: '' };
    const next = applyDraft(nested, draft);
    expect('tools' in next).toBe(false);
  });
});

describe('isDraftDirty', () => {
  it('未改动时为 false', () => {
    const current = { ...base, lazy: true };
    expect(isDraftDirty(draftFromEntry(current), current)).toBe(false);
  });

  it('改动后为 true', () => {
    const current = { ...base };
    const draft = { ...draftFromEntry(current), lazy: true };
    expect(isDraftDirty(draft, current)).toBe(true);
  });
});
