/**
 * global-events — 全局 WS 事件处理（无 session_id，跨视图共享）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  单一权威源：单视图（useMessageStream 回调）和宫格（useGridChat 兜底）
 *  共用同一套全局事件处理逻辑。
 *
 *  职责边界：
 *    ✅ notification.show / notification.clear — 通知系统
 *    ✅ terminal.close — 终端关闭
 *    ✅ terminal.read.request — 终端读取（IIFE 自包含）
 *    ✅ browser.progress — 浏览器连接进度（error/warning → 通知）
 *    ✅ skin.changed — 皮肤切换（当前无主题系统，仅 debug 日志，与单视图 onSkinChanged 语义一致）
 *    ❌ 任何带 session_id 的 per-agent 事件 — 调用方负责
 * ═══════════════════════════════════════════════════════════════════
 */
import { getWsClient } from '@/services/ws-client';
import { playWakeSound, dispatchWakeDetected } from './wake-events';

/**
 * 处理全局 WS 事件（无 session_id）。
 * 动态 import 保持零静态耦合（通知/终端 store 按需加载）。
 * @returns true 如果事件被处理（调用方可跳过后续逻辑）
 */
export function handleGlobalEvent(eventName: string, payload: Record<string, unknown>): boolean {
  switch (eventName) {
    case 'notification.show': {
      const level = (payload.level as string) || 'info';
      const kind = level === 'error' ? 'error'
        : level === 'warn' || level === 'warning' ? 'warning'
        : level === 'success' ? 'success'
        : 'info';
      const isTtl = payload.kind === 'ttl';
      import('../utils/notifications').then(({ notify }) => {
        notify({
          kind,
          message: (payload.text as string) || '',
          key: payload.key as string | undefined,
          durationMs: isTtl ? ((payload.ttl_ms as number) ?? 5000) : undefined,
        });
      }).catch(() => {});
      return true;
    }

    case 'notification.clear':
      import('../utils/notifications').then(({ dismissNotificationByKey }) => {
        dismissNotificationByKey((payload.key as string) || '');
      }).catch(() => {});
      return true;

    case 'terminal.close':
      import('@/store/terminals').then(({ closeAgentTerminalByProc }) => {
        closeAgentTerminalByProc((payload.process_id as string) || '');
      }).catch(() => {});
      return true;

    case 'terminal.read.request': {
      const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';
      if (requestId) {
        const startLine = typeof payload.start_line === 'number' ? payload.start_line : undefined;
        const count = typeof payload.count === 'number' ? payload.count : undefined;
        (async () => {
          const { readActiveTerminal } = await import('@/store/terminal-buffer');
          const result = readActiveTerminal({ start: startLine, count });
          getWsClient().sendRpc('terminal.read.respond', {
            request_id: requestId,
            text: result ? JSON.stringify(result) : '',
          }).catch(() => {});
        })();
      }
      return true;
    }

    case 'browser.progress': {
      const bpLevel = (payload.level as string) || '';
      if (bpLevel === 'error' || bpLevel === 'warning') {
        import('../utils/notifications').then(({ notifyError }) => {
          notifyError((payload.message as string) || '', bpLevel === 'error' ? '浏览器' : '警告');
        }).catch(() => {});
      }
      return true;
    }

    // skin.changed — 当前无主题系统，仅 debug 日志（与单视图 useMessageStream.onSkinChanged 语义一致）
    // 宫格模式 useSSE 暂停时由此处兜底，消灭静默丢弃
    case 'skin.changed':
      console.debug('[global-events] skin.changed', payload.skin);
      return true;

    // wake.detected — 唤醒词命中（常开监听，全局广播无 session_id）
    // 对齐 Hermes wiring.tsx:686：提示音 + 事件总线（App 层开新会话 + 语音）
    case 'wake.detected': {
      playWakeSound();
      dispatchWakeDetected({
        phrase: (payload.phrase as string) || 'hey hermes',
        profile: (payload.profile as string | null) ?? null,
        startNewSession: (payload.start_new_session as boolean) ?? true,
      });
      return true;
    }

    // voice.interrupted — full-duplex barge-in 打断（TTS 已切 + turn 已中断，
    // 纯后端语义事件；前端无额外 UI，debug 留痕防静默丢弃）
    case 'voice.interrupted':
      console.debug('[global-events] voice.interrupted (TTS cut + turns interrupted)');
      return true;

    default:
      return false;
  }
}
