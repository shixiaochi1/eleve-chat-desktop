/**
 * useVoice — 语音输入状态管理（对齐 Hermes Desktop use-composer-voice）
 *
 * 状态机：
 * 1. 点击麦克风 → voice.record(action=start) → 状态 recording（后端做 VAD 录音）
 * 2. 再点一次   → voice.record(action=stop)  → 状态 transcribing（后端停止并转录）
 * 3. transcribing 中再点 → voice.record(action=cancel) → 状态 idle（丢弃录音，不转录）
 *    F3 修复：原实现此处发 stop → 用户已取消仍被转录进输入框
 * 4. 后端转录完成 → 推送 voice.transcript 事件 {text} → 回调插入输入框 → 回到 idle
 * 5. F8: 连续 3 次录音无声 → 后端推 voice.transcript {no_speech_limit:true}
 *    → toast 提示用户（对齐 Hermes voice.py 三振出局 + server.py L13525）
 *
 * 事件载荷契约（对齐后端 ws/mod.rs voice_stop_and_transcribe）：
 * - 正常: { text: string }
 * - 丢弃（太短/无声/幻觉过滤）: { text: "", skipped: true }
 * - 三振出局: { text: "", no_speech_limit: true }
 * - 转录失败: { text: "", error: string }
 *
 * 纯状态管理层，不涉及 UI（麦克风按钮 / 状态条由 InputArea / VoiceActivityBar 渲染）。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getWsClient } from '@/services/ws-client';
import { notify } from '@/utils/notifications';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

interface TranscriptEvent {
  text?: string;
  transcript?: string;
  /** 录音被丢弃（太短/无声/幻觉过滤） */
  skipped?: boolean;
  /** F8: 连续 3 次无声录音，提示用户检查麦克风 */
  no_speech_limit?: boolean;
  /** 转录失败原因 */
  error?: string;
}

/** F7: transcribing 前端超时兜底（秒）— 后端 STT 请求已有 60s 超时，
 * 此处为防御性兜底，防止事件丢失导致 UI 永久卡在 transcribing */
const TRANSCRIBING_TIMEOUT_SECS = 75;

interface UseVoiceOptions {
  /** 转录文本到达时的回调（用于插入输入框） */
  onTranscript?: (text: string) => void;
}

export function useVoice({ onTranscript }: UseVoiceOptions = {}) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  /** 录音已持续秒数（驱动状态条计时器） */
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** F7: transcribing 超时兜底定时器 */
  const transcribingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 ref 持有最新回调，避免订阅事件时闭包过期
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTranscribingTimer = useCallback(() => {
    if (transcribingTimerRef.current) {
      clearTimeout(transcribingTimerRef.current);
      transcribingTimerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [stopTimer]);

  /** F7: 启动 transcribing 超时兜底 — 到期未收到事件则强制回 idle */
  const startTranscribingTimer = useCallback(() => {
    stopTranscribingTimer();
    transcribingTimerRef.current = setTimeout(() => {
      transcribingTimerRef.current = null;
      setStatus('idle');
    }, TRANSCRIBING_TIMEOUT_SECS * 1000);
  }, [stopTranscribingTimer]);

  // 挂载时订阅转录事件；卸载时清理订阅 + 计时器
  useEffect(() => {
    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName, data) => {
      if (eventName === 'voice.transcript' || eventName === 'voice.transcription') {
        const payload = (data || {}) as TranscriptEvent;
        const text = payload.text || payload.transcript || '';
        setStatus('idle');
        setElapsed(0);
        stopTimer();
        stopTranscribingTimer();
        if (text) {
          onTranscriptRef.current?.(text);
        } else if (payload.no_speech_limit) {
          // F8: 三振出局提示（对齐 Hermes on_silent_limit → UI 反映 voice off）
          notify({
            kind: 'warning',
            title: '未检测到语音',
            message: '连续多次录音没有捕获到语音，请检查麦克风或靠近麦克风后重试。',
          });
        } else if (payload.error) {
          notify({
            kind: 'error',
            title: '语音转录失败',
            message: payload.error,
          });
        }
        // skipped（太短/无声/幻觉过滤）静默回 idle，不打扰用户
      }
    });
    return () => {
      unsubscribe();
      stopTimer();
      stopTranscribingTimer();
    };
  }, [stopTimer, stopTranscribingTimer]);

  /** 切换录音状态：idle→recording→transcribing→idle */
  const toggle = useCallback(async () => {
    const ws = getWsClient();

    if (status === 'recording') {
      // 停止录音 → 等待转录
      setStatus('transcribing');
      stopTimer();
      startTranscribingTimer();
      try {
        await ws.voiceRecord('stop');
      } catch (err) {
        console.warn('[useVoice] stop recording failed:', err);
        setStatus('idle');
        stopTranscribingTimer();
      }
      return;
    }

    if (status === 'idle') {
      // 开始录音
      setStatus('recording');
      startTimer();
      try {
        await ws.voiceRecord('start');
      } catch (err) {
        console.warn('[useVoice] start recording failed:', err);
        setStatus('idle');
        stopTimer();
      }
      return;
    }

    // F3: transcribing 中 → 发 cancel 通知后端丢弃录音（原实现只改本地状态，
    // 后端仍完成转录并把文本推进输入框 —— 用户取消无效）
    setStatus('idle');
    setElapsed(0);
    stopTimer();
    stopTranscribingTimer();
    try {
      await ws.voiceRecord('cancel');
    } catch (err) {
      console.warn('[useVoice] cancel recording failed:', err);
    }
  }, [status, startTimer, stopTimer, startTranscribingTimer, stopTranscribingTimer]);

  return { status, elapsed, toggle };
}
