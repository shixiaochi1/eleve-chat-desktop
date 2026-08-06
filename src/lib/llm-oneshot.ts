/**
 * llm.oneshot — 单次 LLM 调用（对齐 Hermes store/projects.ts generateProjectIdea）
 * 后端 WS RPC（llm.oneshot）：辅助任务 auxiliary client（默认 auto 主模型，
 * 可配置 auxiliary.llm_oneshot.ref），非流式 + temperature。
 */

import { call } from '../utils/bridge';

/** 生成项目 idea（对齐 Hermes generateProjectIdea；失败返回空串） */
export async function generateProjectIdea(name: string, profile?: string): Promise<string> {
  try {
    const res = await call('llm_oneshot', {
      instructions:
        'You generate a single, concrete project idea as a short IDEA.md body: a one-line summary, ' +
        'then 3-5 bullet goals. No preamble, no code fences, under 120 words.',
      input: name.trim() ? `Project name: ${name.trim()}` : 'Surprise me with a fun project.',
      temperature: 1.0,
      ...(profile ? { profile } : {}),
    });
    return String(((res as { text?: string })?.text) ?? '').trim();
  } catch {
    return '';
  }
}
