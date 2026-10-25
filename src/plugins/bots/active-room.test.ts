import { describe, expect, it } from 'vitest';
import { getActiveRoomId, setActiveRoomId } from './active-room';

describe('active-room — 房间可见性信号', () => {
  it('set/get 同步；重复值不抖动（值相同即 no-op）', () => {
    setActiveRoomId('room-1');
    expect(getActiveRoomId()).toBe('room-1');
    setActiveRoomId('room-1');
    expect(getActiveRoomId()).toBe('room-1');
    setActiveRoomId(null);
    expect(getActiveRoomId()).toBeNull();
  });
});
