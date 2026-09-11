import { describe, it, expect } from 'vitest';
import type { RoomAttachmentDraft } from '../utils/api';
import {
  botRoomDraftSnapshot,
  clearBotRoomDraft,
  patchBotRoomDraft,
  restoreBotRoomDraft,
} from './bot-room-drafts';

/** 对齐 Hermes `group-panes.ts` 的 `groupComposerDrafts`（窗口本地、模块级、不持久化）。 */
describe('bot-room-drafts — 房间级草稿（切房/重挂不丢）', () => {
  // 每个用例用独立 roomId，避免模块级 Map 跨用例串味（库刻意不暴露测试重置口）
  let seq = 0;
  const rid = () => `room-${Date.now()}-${seq++}`;
  const att = (name: string): RoomAttachmentDraft => ({
    name,
    kind: 'image',
    data: 'data:image/png;base64,AAAA',
    thumb: 'data:image/jpeg;base64,BBBB',
  });

  it('未写过的房间 = 空草稿', () => {
    const d = botRoomDraftSnapshot(rid());
    expect(d).toEqual({ main: '', replies: {}, attachments: [], expandedThreads: [], revision: 0 });
  });

  it('patch 写回后能读到（切房回来草稿还在）', () => {
    const r = rid();
    patchBotRoomDraft(r, { main: '半截输入' });
    expect(botRoomDraftSnapshot(r).main).toBe('半截输入');
  });

  it('按房间隔离：另一个房间读不到本房草稿', () => {
    const a = rid();
    const b = rid();
    patchBotRoomDraft(a, { main: 'A 的草稿' });
    expect(botRoomDraftSnapshot(b).main).toBe('');
  });

  it('字段级替换：显式传的字段覆盖，未传的保持', () => {
    const r = rid();
    patchBotRoomDraft(r, { main: 'm1', replies: { t1: 'r1' } });
    const after = patchBotRoomDraft(r, { main: 'm2' });
    expect(after.main).toBe('m2');
    expect(after.replies).toEqual({ t1: 'r1' });
  });

  it('revision 每次 patch 自增（乐观恢复的守卫依据）', () => {
    const r = rid();
    expect(botRoomDraftSnapshot(r).revision).toBe(0);
    expect(patchBotRoomDraft(r, { main: 'a' }).revision).toBe(1);
    expect(patchBotRoomDraft(r, { main: 'b' }).revision).toBe(2);
  });

  it('🔴 快照是副本：改它不会污染库', () => {
    const r = rid();
    patchBotRoomDraft(r, { main: 'x', replies: { t1: 'y' }, attachments: [att('a1')] });
    const snap = botRoomDraftSnapshot(r);
    snap.main = '被改了';
    snap.replies.t1 = '被改了';
    snap.attachments.push(att('a2'));

    const again = botRoomDraftSnapshot(r);
    expect(again.main).toBe('x');
    expect(again.replies.t1).toBe('y');
    expect(again.attachments).toHaveLength(1);
  });

  it('restore：revision 匹配 → 草稿被放回', () => {
    const r = rid();
    const before = botRoomDraftSnapshot(r);
    patchBotRoomDraft(r, { main: '发出去的内容' });
    const cleared = patchBotRoomDraft(r, { main: '' }); // 发送时清空

    const restored = restoreBotRoomDraft(r, cleared.revision, { ...before, main: '发出去的内容' });
    expect(restored?.main).toBe('发出去的内容');
    expect(botRoomDraftSnapshot(r).main).toBe('发出去的内容');
  });

  it('🔴 restore：期间用户又敲了字（revision 变了）→ 不恢复、不覆盖新输入', () => {
    const r = rid();
    const before = botRoomDraftSnapshot(r);
    const cleared = patchBotRoomDraft(r, { main: '' });
    // 发送到失败之间用户敲了新内容
    patchBotRoomDraft(r, { main: '新的输入' });

    expect(restoreBotRoomDraft(r, cleared.revision, before)).toBeNull();
    expect(botRoomDraftSnapshot(r).main).toBe('新的输入');
  });

  it('clear 丢弃该房草稿', () => {
    const r = rid();
    patchBotRoomDraft(r, { main: 'x' });
    clearBotRoomDraft(r);
    expect(botRoomDraftSnapshot(r).main).toBe('');
  });

  it('附件与展开集也随房持久', () => {
    const r = rid();
    patchBotRoomDraft(r, { attachments: [att('a1'), att('a2')], expandedThreads: ['user:1'] });
    const d = botRoomDraftSnapshot(r);
    expect(d.attachments.map((a) => a.name)).toEqual(['a1', 'a2']);
    expect(d.expandedThreads).toEqual(['user:1']);
  });
});
