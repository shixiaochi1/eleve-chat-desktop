/**
 * steer 行显示还原的单元测试（2026-09-11 对齐 Hermes desktop）。
 *
 * 背景：后端把中途 `/steer` 交付为**独立 `role:user` 行**，content 是模型侧
 * OOB 标记壳（对齐 Hermes `d24810483d`：不再涂抹已落库的 tool 行，避免
 * replay 与 live 请求字节分叉 + 用户指令永不进历史）。展示面必须还原为
 * 用户自己说的话（Hermes：*"history projects the steer row as the user's own
 * words instead of the model-facing marker wrapper"*）。
 */
import { describe, it, expect } from 'vitest';
import { stripSteerMarker } from './chat-messages';

const OPEN =
  '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]';
const CLOSE = '[/OUT-OF-BAND USER MESSAGE]';

describe('stripSteerMarker', () => {
  it('完整标记块 → 只留用户正文', () => {
    expect(stripSteerMarker(`${OPEN}\n改用 Rust 写这个模块\n${CLOSE}`)).toBe(
      '改用 Rust 写这个模块',
    );
  });

  it('无标记 → 逐字节原样（幂等）', () => {
    expect(stripSteerMarker('普通用户消息')).toBe('普通用户消息');
    expect(stripSteerMarker('')).toBe('');
  });

  it('正文含 ] 也能正确切到闭合标记', () => {
    expect(stripSteerMarker(`${OPEN}\n看 a[0] 那行\n${CLOSE}`)).toBe('看 a[0] 那行');
  });

  it('多个标记块全部还原（空行分隔）', () => {
    expect(stripSteerMarker(`${OPEN}\n第一条\n${CLOSE}\n\n${OPEN}\n第二条\n${CLOSE}`)).toBe(
      '第一条\n\n第二条',
    );
  });

  it('未闭合开口（理论上不会出现）→ 丢尾，不留标记残渣', () => {
    expect(stripSteerMarker(`${OPEN}\n半截内容`)).toBe('');
  });

  it('标记前后的多余空白被 trim（对齐后端 .lstrip() 的另一侧）', () => {
    expect(stripSteerMarker(`\n\n${OPEN}\n  正文  \n${CLOSE}\n\n`)).toBe('正文');
  });
});
