/**
 * tool-row-model 单元测试——用例锚定后端真实数据形状（逐字段核实过）：
 * terminal.rs {output, exit_code} / execute_code.rs {output, stderr, status, error}
 * / web.rs {results:[{title,url,description}]} / file.rs {content, total_lines, truncated}
 * / clarify.rs 单题 {question, user_response} + 批量 {responses, timed_out}
 * / delegate/types.rs DetailedResult {task_index, status, summary, ...}
 * / todo.rs {todos:[{id, content, status}]}
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTool, toolTitle, deriveSummary, relativizeToCwd, deriveState,
  deriveErrorSummary, toolRowModel, clampForDisplay,
  terminalCardModel, searchCardModel, readCardModel,
  todoRowModel, clarifyRowModel, delegateRowModel, specializedRowModel,
  delegateCardModel, delegateStatusLabel,
} from './tool-row-model';
import { appendTextPart, textPart } from '@/lib/chat-messages';

describe('classifyTool / toolTitle', () => {
  it('variant 表命中', () => {
    expect(classifyTool('terminal')).toBe('bash');
    expect(classifyTool('read_file')).toBe('read');
    expect(classifyTool('web_search')).toBe('search');
    expect(classifyTool('session_search')).toBe('search');
    expect(classifyTool('write_file')).toBe('write');
    expect(classifyTool('patch')).toBe('edit');
    expect(classifyTool('web_extract')).toBe('web');
    expect(classifyTool('browser_navigate')).toBe('browser');
  });

  it('computer_use 是动作回执 → others（不进 bash/终端卡）', () => {
    expect(classifyTool('computer_use')).toBe('others');
  });

  it('web_fetch 不存在（ELEVE 网页抓取是 web_extract）→ others', () => {
    expect(classifyTool('web_fetch')).toBe('others');
  });

  it('未知工具 → others', () => {
    expect(classifyTool('totally_unknown')).toBe('others');
  });

  it('工具专属标题覆盖 variant 标题', () => {
    expect(toolTitle('others', 'delegate_task')).toBe('委派');
    expect(toolTitle('others', 'clarify')).toBe('澄清提问');
    expect(toolTitle('bash', 'pwsh')).toBe('Pwsh');
  });

  it('无专属标题回落 variant 标题', () => {
    expect(toolTitle('search', 'web_search')).toBe('搜索');
    expect(toolTitle('others', 'unknown_tool')).toBe('工具调用');
  });
});

describe('deriveSummary（variant 键表 + fallback）', () => {
  it('bash 优先 description，回落 command', () => {
    expect(deriveSummary('bash', { description: '安装依赖', command: 'npm i' })).toBe('安装依赖');
    expect(deriveSummary('bash', { command: 'npm run build' })).toBe('npm run build');
  });

  it('read 键序 path → file_path', () => {
    expect(deriveSummary('read', { file_path: 'b.ts', path: 'a.ts' })).toBe('a.ts');
  });

  it('search 键序 query → pattern', () => {
    expect(deriveSummary('search', { query: 'rust async' })).toBe('rust async');
  });

  it('others 空键表 fallback 遍历首个字符串字段', () => {
    expect(deriveSummary('others', { goal: '修复构建', count: 3 })).toBe('修复构建');
  });

  it('多行值取第一行', () => {
    expect(deriveSummary('bash', { command: 'line1\nline2' })).toBe('line1');
  });

  it('args 是原始字符串（非 JSON）→ 取首行', () => {
    expect(deriveSummary('others', 'raw text\nsecond')).toBe('raw text');
  });

  it('流式截断的半截 JSON → 回退原始串', () => {
    expect(deriveSummary('bash', '{"command": "cargo bu')).toBe('{"command": "cargo bu');
  });

  it('空 args → 空摘要（分隔点随空摘要消失）', () => {
    expect(deriveSummary('read', {})).toBe('');
  });
});

describe('relativizeToCwd', () => {
  it('剥离 Windows 工作区前缀', () => {
    expect(relativizeToCwd('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src\\a.ts');
  });

  it('cwd 尾斜杠容忍', () => {
    expect(relativizeToCwd('C:\\repo\\a.ts', 'C:\\repo\\')).toBe('a.ts');
  });

  it('非工作区内路径原样返回', () => {
    expect(relativizeToCwd('D:\\other\\a.ts', 'C:\\repo')).toBe('D:\\other\\a.ts');
  });

  it('无 cwd 原样返回', () => {
    expect(relativizeToCwd('C:\\repo\\a.ts', undefined)).toBe('C:\\repo\\a.ts');
  });
});

describe('deriveState', () => {
  it('三值状态映射', () => {
    expect(deriveState('pending')).toBe('running');
    expect(deriveState('done')).toBe('ok');
    expect(deriveState('error')).toBe('error');
    expect(deriveState(undefined)).toBe('running');
  });
});

describe('deriveErrorSummary（错误行折叠摘要）', () => {
  it('结构化 error 字段优先', () => {
    expect(deriveErrorSummary('{"error": "boom"}', { error: 'boom', other: 1 })).toBe('boom');
  });

  it('多行取首行', () => {
    expect(deriveErrorSummary('line1\nline2', 'line1\nline2')).toBe('line1');
  });

  it('空结果 → null', () => {
    expect(deriveErrorSummary(undefined, null)).toBe(null);
    expect(deriveErrorSummary('', {})).toBe(null);
  });
});

describe('toolRowModel（集成）', () => {
  it('terminal 落定：variant/title/summary 全派生', () => {
    const m = toolRowModel('terminal', { command: 'npm test' }, '{"output":"passed","exit_code":0}', { output: 'passed', exit_code: 0 }, 'done', undefined);
    expect(m.variant).toBe('bash');
    expect(m.title).toBe('执行');
    expect(m.summary).toBe('npm test');
    expect(m.state).toBe('ok');
    expect(m.errorSummary).toBe(null);
  });

  it('错误状态派生 errorSummary', () => {
    const m = toolRowModel('terminal', { command: 'x' }, '{"error":"boom"}', { error: 'boom' }, 'error', undefined);
    expect(m.state).toBe('error');
    expect(m.errorSummary).toBe('boom');
  });

  it('read/write/edit 派生 filePath，bash 不派生', () => {
    const read = toolRowModel('read_file', { path: 'C:\\r\\a.ts' }, undefined, undefined, 'pending', 'C:\\r');
    expect(read.filePath).toBe('a.ts');
    const bash = toolRowModel('terminal', { command: 'x' }, undefined, undefined, 'pending', 'C:\\r');
    expect(bash.filePath).toBeUndefined();
  });
});

describe('terminalCardModel', () => {
  it('terminal 落定（output + exit_code）→ 合并渲染', () => {
    const c = terminalCardModel('terminal', { command: 'ls' }, { output: 'file1\nfile2', exit_code: 0 })!;
    expect(c).not.toBeNull();
    expect(c.command).toBe('ls');
    expect(c.output).toBe('file1\nfile2');
    expect(c.stdout).toBeUndefined();
    expect(c.stderr).toBeUndefined();
    expect(c.exitCode).toBe(0);
  });

  it('🔴 回归：execute_code output + stderr 并存——output 归 stdout 段不丢失', () => {
    const c = terminalCardModel('execute_code', { code: 'print(1)' }, { status: 'success', output: '1', stderr: 'warn line' })!;
    expect(c).not.toBeNull();
    expect(c.stdout).toBe('1');
    expect(c.stderr).toBe('warn line');
    expect(c.output).toBe('');
  });

  it('🔴 回归：computer_use 是动作回执 → null（不渲染空壳卡）', () => {
    expect(terminalCardModel('computer_use', { action: 'click' }, { action: 'click' })).toBeNull();
  });

  it('running（无 result）→ null', () => {
    expect(terminalCardModel('terminal', { command: 'ls' }, null)).toBeNull();
  });

  it('exit_code 非数值 → null 徽标', () => {
    const c = terminalCardModel('terminal', { command: 'x' }, { output: '', exit_code: 'NaN-ish' })!;
    expect(c.exitCode).toBeNull();
  });

  it('超长输出 clamp', () => {
    const big = 'x'.repeat(30_000);
    const c = terminalCardModel('terminal', { command: 'x' }, { output: big, exit_code: 0 })!;
    expect(c.output.length).toBeLessThan(big.length);
    expect(c.output).toContain('字符已截断');
  });
});

describe('searchCardModel', () => {
  it('web_search 结构化结果（title/url/snippet 键序）', () => {
    const c = searchCardModel('web_search', { query: 'rust' }, {
      results: [
        { title: 'Rust Lang', url: 'https://rust-lang.org', description: 'A language' },
      ],
    })!;
    expect(c.query).toBe('rust');
    expect(c.hits[0]).toEqual({ title: 'Rust Lang', url: 'https://rust-lang.org', snippet: 'A language' });
  });

  it('🔴 回归：工具名门控——delegate_task 的 results 形状不入搜索卡', () => {
    expect(searchCardModel('delegate_task', { goal: 'x' }, { results: [{ status: 'completed', summary: 'done' }] })).toBeNull();
  });

  it('条目无 title/url → null', () => {
    expect(searchCardModel('web_search', { query: 'x' }, { results: [{ foo: 1 }] })).toBeNull();
  });

  it('命中上限 6', () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, url: `u${i}` }));
    expect(searchCardModel('web_search', { query: 'x' }, { results: list })!.hits).toHaveLength(6);
  });
});

describe('readCardModel', () => {
  const backendContent = 'line one\nline two\nline three';

  it('无行号 content → 前端从 1 编号', () => {
    const c = readCardModel('read_file', { path: 'C:\\r\\a.ts' }, { content: backendContent, total_lines: 3 }, 'C:\\r')!;
    expect(c.label).toBe('a.ts');
    expect(c.lines[0]).toEqual({ number: 1, text: 'line one' });
    expect(c.lines[2].number).toBe(3);
    expect(c.totalLines).toBe(3);
  });

  it('🔴 回归：后端已带行号（add_line_numbers `1|text` 格式）→ 跳过 gutter 不双编号', () => {
    const c = readCardModel('read_file', { path: 'a.ts' }, { content: '1|line one\n2|line two' }, undefined)!;
    expect(c.lines[0].number).toBe(0);
    expect(c.lines[0].text).toBe('1|line one');
    expect(c.lines[1].text).toBe('2|line two');
  });

  it('offset 页偏移进入起始行号', () => {
    const c = readCardModel('read_file', { path: 'a.ts', offset: 10 }, { content: 'mid line' }, undefined)!;
    expect(c.lines[0].number).toBe(10);
  });

  it('running / 空 content → null', () => {
    expect(readCardModel('read_file', { path: 'a' }, null, undefined)).toBeNull();
    expect(readCardModel('read_file', { path: 'a' }, { content: '' }, undefined)).toBeNull();
  });

  it('web_fetch 已删除 → null', () => {
    expect(readCardModel('web_fetch', { url: 'u' }, { content: 'x' }, undefined)).toBeNull();
  });
});

describe('todoRowModel（keyed 专属行）', () => {
  const todos = (items: Array<[string, string]>) => ({ todos: items.map(([content, status], i) => ({ id: `t${i}`, content, status })) });

  it('已完成 N/M · 正在: 活动项 + 并行数 suffix', () => {
    const r = todoRowModel(todos([['a', 'completed'], ['b', 'in_progress'], ['c', 'in_progress']]), todos([['a', 'completed'], ['b', 'in_progress'], ['c', 'in_progress']]), 'ok')!;
    expect(r.title).toBe('任务规划');
    expect(r.summary).toBe('已完成 1/3 · 正在: b');
    expect(r.summarySuffix).toBe('+1');
  });

  it('running 态读作更新而非完成', () => {
    const r = todoRowModel(todos([['a', 'pending']]), todos([['a', 'pending']]), 'running')!;
    expect(r.summary).toContain('更新任务');
  });

  it('🔴 后端允许空 content 条目——计数保留、不参与"正在:"展示', () => {
    const data = { todos: [{ id: '1', content: '', status: 'completed' }, { id: '2', content: 'real', status: 'in_progress' }] };
    const r = todoRowModel(data, data, 'ok')!;
    expect(r.summary).toBe('已完成 1/2 · 正在: real');
  });

  it('error 态 → null（不读作完成更新，对齐 DSH）', () => {
    expect(todoRowModel(todos([['a', 'completed']]), todos([['a', 'completed']]), 'error')).toBeNull();
  });
});

describe('clarifyRowModel（keyed 专属行）', () => {
  it('running → 等待用户回答', () => {
    expect(clarifyRowModel(null, 'running')!.summary).toBe('等待用户回答…');
  });

  it('批量：user_response 空串计未答（对齐后端 batch_row）', () => {
    const r = clarifyRowModel({ responses: [{ question: 'q1', user_response: 'yes' }, { question: 'q2', user_response: '' }] }, 'ok')!;
    expect(r.summary).toBe('已回答 1/2');
  });

  it('批量超时明示', () => {
    const r = clarifyRowModel({ responses: [{ question: 'q1', user_response: '' }], timed_out: true }, 'ok')!;
    expect(r.summary).toContain('已超时');
  });

  it('🔴 单题结构（{question, user_response}）→ 已回答', () => {
    const r = clarifyRowModel({ question: 'Which?', choices_offered: ['A'], user_response: 'A' }, 'ok')!;
    expect(r.summary).toBe('已回答');
  });

  it('🔴 单题 multi_select（user_response 为数组）', () => {
    const r = clarifyRowModel({ question: 'Which?', user_response: ['A', 'B'] }, 'ok')!;
    expect(r.summary).toBe('已回答');
  });

  it('单题未答 → 未回答', () => {
    expect(clarifyRowModel({ question: 'Q', user_response: '' }, 'ok')!.summary).toBe('未回答');
  });

  it('error 态 → null（走通用错误语义）', () => {
    expect(clarifyRowModel(null, 'error')).toBeNull();
  });
});

describe('delegateRowModel（keyed 专属行）', () => {
  const task = (status: string, summary?: string) => ({ task_index: 0, status, summary: summary ?? null, duration_seconds: 1 });

  it('running → 子任务执行中', () => {
    expect(delegateRowModel(null, 'running')!.summary).toBe('子任务执行中…');
  });

  it('🔴 多任务计数（对齐后端 DelegateEnd summary 语义）', () => {
    const r = delegateRowModel({ results: [task('completed'), task('completed'), task('failed')] }, 'ok')!;
    expect(r.summary).toBe('3 项任务: 2 成功, 1 失败');
  });

  it('🔴 回归：单任务 failed 无 summary → 不谎报"已完成"', () => {
    const r = delegateRowModel({ results: [task('failed')] }, 'ok')!;
    expect(r.summary).toBe('任务未完成（失败）');
  });

  it('单任务 completed 有 summary → 显示摘要', () => {
    const r = delegateRowModel({ results: [task('completed', 'it is done')] }, 'ok')!;
    expect(r.summary).toBe('it is done');
  });

  it('interrupted → 任务未完成（已中断）', () => {
    expect(delegateRowModel({ results: [task('interrupted')] }, 'ok')!.summary).toBe('任务未完成（已中断）');
  });

  it('error 态 → null', () => {
    expect(delegateRowModel(null, 'error')).toBeNull();
  });
});

describe('specializedRowModel（keyed 分发）', () => {
  const todos = { todos: [{ id: '1', content: 'a', status: 'pending' }] };

  it('命中 todo/clarify/delegate_task', () => {
    // todo 摘要依赖 todos 数据（实际调用 args 必带全量列表），null args → 通用行兜底
    expect(specializedRowModel('todo', todos, null, 'running')).not.toBeNull();
    expect(specializedRowModel('clarify', null, null, 'running')).not.toBeNull();
    expect(specializedRowModel('delegate_task', null, null, 'running')).not.toBeNull();
  });

  it('todo 无数据（running 且 args 未到）→ null 通用行兜底', () => {
    expect(specializedRowModel('todo', null, null, 'running')).toBeNull();
  });

  it('未命中 → null（通用行兜底）', () => {
    expect(specializedRowModel('terminal', null, null, 'running')).toBeNull();
  });
});

describe('delegateCardModel（展开体任务卡）', () => {
  it('DetailedResult 字段映射', () => {
    const c = delegateCardModel({
      results: [{ task_index: 0, status: 'completed', summary: 'done', duration_seconds: 2.5, model: 'gpt' }],
    })!;
    expect(c.tasks[0]).toEqual({ index: 0, status: 'completed', summary: 'done', error: '', durationSeconds: 2.5, model: 'gpt' });
  });

  it('空/无 results → null', () => {
    expect(delegateCardModel(null)).toBeNull();
    expect(delegateCardModel({ results: [] })).toBeNull();
  });
});

describe('delegateStatusLabel', () => {
  it('四值状态中文', () => {
    expect(delegateStatusLabel('completed')).toBe('成功');
    expect(delegateStatusLabel('failed')).toBe('失败');
    expect(delegateStatusLabel('interrupted')).toBe('已中断');
    expect(delegateStatusLabel('error')).toBe('错误');
    expect(delegateStatusLabel('weird')).toBe('weird');
  });
});

describe('appendTextPart（流式文本累加——文本晚到/空 delta 回归）', () => {
  const toolPart = { type: 'tool-call', toolCallId: 't1', toolName: 'terminal', args: {}, argsText: '' } as never;

  it('🔴 工具后文本段：text → tool → deltaB → deltaC 并入单一 text part（不碎裂成 N 气泡）', () => {
    const withTool = [textPart('我来查一下'), toolPart];
    const step1 = appendTextPart(withTool, '查询');
    const step2 = appendTextPart(step1, '结果是');
    const texts = step2.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text);
    // 两段文本都渲染在工具上方 → 并入单一 text part 才是连续文本流（Hermes 文本槽位形态），
    // 每 delta 各自新开 part 会把工具后的总结文本碎裂成 N 个独立气泡
    expect(texts).toEqual(['我来查一下查询结果是']);
    // 工具行仍在文本之后（Hermes 视觉：文本上、工具下）
    expect(step2.at(-1)?.type).toBe('tool-call');
    // 单一 text part → MessageRow isLast 判定稳定，流式 streaming 标记生效
    expect(texts).toHaveLength(1);
  });

  it('🔴 空 delta 防御：尾部非 text 时不新开空 text part（防空气泡）', () => {
    const parts = [textPart('a'), toolPart];
    expect(appendTextPart(parts, '').length).toBe(parts.length);
  });

  it('空 parts + 空 delta → 不建段', () => {
    expect(appendTextPart([], '')).toEqual([]);
  });
});

describe('clampForDisplay', () => {
  it('短文本原样', () => {
    expect(clampForDisplay('short')).toBe('short');
  });

  it('超长截断并提示', () => {
    const out = clampForDisplay('x'.repeat(25_000));
    expect(out).toContain('字符已截断');
    expect(out.length).toBeLessThan(25_000);
  });
});
