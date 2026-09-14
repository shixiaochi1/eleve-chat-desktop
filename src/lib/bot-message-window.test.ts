import { describe, it, expect } from 'vitest';
import {
  MESSAGE_WINDOW_PAGE,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  isNearBottom,
  messageWindow,
  renderWindow,
} from './bot-message-window';

/** 窗口是从**尾部**算的：加载更早历史必须靠 `size` 增长才可见（这是之前的 bug 根因）。 */
describe('messageWindow — 尾部窗口', () => {
  const items = [1, 2, 3, 4, 5];

  it('窗口大于等于总数 → 全部（保序）', () => {
    expect(messageWindow(items, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(messageWindow(items, 99)).toEqual([1, 2, 3, 4, 5]);
  });

  it('窗口小于总数 → 只保留**最后** size 条（保序）', () => {
    expect(messageWindow(items, 2)).toEqual([4, 5]);
    expect(messageWindow(items, 1)).toEqual([5]);
  });

  it('窗口增长 = 更早的历史进入渲染（旧实现恒切尾部 ⇒ 加载无效）', () => {
    const before = messageWindow(items, 2);
    const after = messageWindow(items, 4);
    expect(before).toEqual([4, 5]);
    expect(after).toEqual([2, 3, 4, 5]);
    expect(after[0]).toBe(2); // 新进来的更早事件在窗口**头部**，而不是被丢掉
  });

  it('非法 size / 空输入 → 空数组（未知不当"全都要"）', () => {
    expect(messageWindow(items, 0)).toEqual([]);
    expect(messageWindow(items, -1)).toEqual([]);
    expect(messageWindow(items, Number.NaN)).toEqual([]);
    expect(messageWindow(items, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(messageWindow([], 10)).toEqual([]);
  });

  it('返回新数组（调用方原地改不污染入参）', () => {
    const out = messageWindow(items, 5);
    out.push(6);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('页大小常量 = 后端页大小 200（同源）', () => {
    expect(MESSAGE_WINDOW_PAGE).toBe(200);
  });
});

/** 组件的实际取窗：默认一页；用户点过"加载更早消息"后 = 全部已载入。 */
describe('renderWindow — 默认一页 / 展开后全部', () => {
  const events = Array.from({ length: 450 }, (_, i) => i + 1);

  it('未展开 → 只渲染最新一页（DOM 有界）', () => {
    const out = renderWindow(events, false);
    expect(out).toHaveLength(MESSAGE_WINDOW_PAGE);
    expect(out[0]).toBe(251);
    expect(out[out.length - 1]).toBe(450);
  });

  it('展开后 → 渲染全部已载入（加载到的历史**不会**被后续新事件挤出窗口）', () => {
    const loaded = [...events, 451, 452];
    const out = renderWindow(loaded, true);
    expect(out).toHaveLength(452);
    expect(out[0]).toBe(1); // 最早那条仍在窗口里
    expect(out[out.length - 1]).toBe(452);
  });

  it('展开且不足一页 → 全部（不会补空）', () => {
    expect(renderWindow([1, 2, 3], true)).toEqual([1, 2, 3]);
    expect(renderWindow([], true)).toEqual([]);
  });

  it('返回新数组（渲染层不共享可变引用）', () => {
    const out = renderWindow(events, true);
    out.pop();
    expect(events).toHaveLength(450);
  });
});

/** 粘底判据 = `scrollHeight - scrollTop - clientHeight < 80`（Hermes :543 同款）。 */
describe('isNearBottom — 粘底判据（对齐 Hermes #89835）', () => {
  const viewport = { clientHeight: 500 };

  it('完全在底部 → true；距底 79px → true', () => {
    expect(isNearBottom({ ...viewport, scrollHeight: 1000, scrollTop: 500 })).toBe(true);
    expect(isNearBottom({ ...viewport, scrollHeight: 1000, scrollTop: 421 })).toBe(true);
  });

  it('距底恰好 80px → false（严格小于，与 Hermes 的 `<` 一致）', () => {
    expect(isNearBottom({ ...viewport, scrollHeight: 1000, scrollTop: 420 })).toBe(false);
  });

  it('上翻读历史（距底很远）→ false', () => {
    expect(isNearBottom({ ...viewport, scrollHeight: 5000, scrollTop: 0 })).toBe(false);
  });

  it('内容不足一屏（无滚动）→ true，不会被误判成"用户上翻了"', () => {
    expect(isNearBottom({ clientHeight: 500, scrollHeight: 300, scrollTop: 0 })).toBe(true);
  });

  it('阈值可覆盖，默认值 = Hermes 的 80', () => {
    expect(STICK_TO_BOTTOM_THRESHOLD_PX).toBe(80);
    expect(isNearBottom({ ...viewport, scrollHeight: 1000, scrollTop: 420 }, 100)).toBe(true);
  });
});
