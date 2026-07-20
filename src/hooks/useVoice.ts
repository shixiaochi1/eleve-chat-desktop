/**
 * useVoice — 语音输入状态管理（对齐 Hermes Desktop use-composer-voice）
 *
 * 架构（前端先行、按契约接线，后端实现后直接可用）：
 * 1. 点击麦克风 → voice.record(action=start) → 状态 recording（后端做 VAD 录音）
 * 2. 再点一次   → voice.record(action=stop)  → 状态 transcribing（后端停止并转录）
 * 3. 后端转录完成 → 推送 voice.transcript 事件 {text} → 回调插入输入框 → 回到 idle
 *
 * 约定（需后端实现方遵守，见 docs 阶段三记录）：
 * - 转录结果通过 WS 事件 `voice.transcript`（或兼容 `voice.transcription`）推送，
 *   载荷为 { text: string }（兼容 { transcript: string }）。
 * - 当前后端 voice.record 为占位实现（返回假状态），UI 状态机已按真实流程搭好，
 *   后端接入 VAD/STT 后无需改前端即可工作。
 *
 * 纯状态管理层，不涉及 UI（麦克风按钮 / 状态条由 InputArea / VoiceActivityBar 渲染）。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getWsClient } from '@/services/ws-client';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

interface TranscriptEvent {
  text?: string;
  transcript?: string;
}

interface UseVoiceOptions {
  /** 转录文本到达时的回调（用于插入输入框） */
  onTranscript?: (text: string) => void;
}

export function useVoice({ onTranscript }: UseVoiceOptions = {}) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  /** 录音已持续秒数（驱动状态条计时器） */
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 用 ref 持有最新回调，避免订阅事件时闭包过期
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [stopTimer]);

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
        if (text) onTranscriptRef.current?.(text);
      }
    });
    return () => {
      unsubscribe();
      stopTimer();
    };
  }, [stopTimer]);

  /** 切换录音状态：idle→recording→transcribing→idle */
  const toggle = useCallback(async () => {
    const ws = getWsClient();

    if (status === 'recording') {
      // 停止录音 → 等待转录
      setStatus('transcribing');
      stopTimer();
      try {
        await ws.voiceRecord('stop');
      } catch (err) {
        console.warn('[useVoice] stop recording failed:', err);
        setStatus('idle');
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

    // transcribing 中 → 取消，回到空闲
    setStatus('idle');
    setElapsed(0);
    stopTimer();
  }, [status, startTimer, stopTimer]);

  return { status, elapsed, toggle };
}
