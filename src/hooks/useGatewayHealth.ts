import { useState, useEffect, useRef, useCallback } from 'react';
import { checkHealth } from '../utils/api';

/**
 * 网关健康监测 hook — 定时检测 + 状态切换回调
 *
 * Usage:
 *   const { online, checking, checkNow } = useGatewayHealth({
 *     interval: 10000,      // 检测间隔（ms），默认 10s
 *     onOnline: () => {},   // 网关上线回调
 *     onOffline: () => {},  // 网关离线回调
 *     enabled: false,       // 是否开始轮询（等待端口就绪后再启用）
 *   });
 *
 * 重要：enabled=false 时不会启动定时器，等端口确定后再设为 true 启动。
 */
export function useGatewayHealth({ interval = 10000, onOnline, onOffline, enabled = true }: {
  interval?: number;
  onOnline?: () => void;
  onOffline?: () => void;
  enabled?: boolean;
} = {}) {
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(enabled);
  const callbacksRef = useRef<{ onOnline?: () => void; onOffline?: () => void }>({ onOnline, onOffline });
  callbacksRef.current = { onOnline, onOffline };
  enabledRef.current = enabled;

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const ok = await checkHealth();
      setOnline((prev) => {
        if (!prev && ok) callbacksRef.current.onOnline?.();
        if (prev && !ok) callbacksRef.current.onOffline?.();
        return ok;
      });
    } catch {
      setOnline((prev) => {
        if (prev) callbacksRef.current.onOffline?.();
        return false;
      });
    } finally {
      setChecking(false);
    }
  }, []);

  // 等 enabled=true 才开始初始检测 + 定时轮询
  useEffect(() => {
    if (!enabled) {
      // 还没就绪：停止旧定时器，不启动新检测
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    check();
    timerRef.current = setInterval(check, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [check, interval, enabled]);

  // 手动触发检测
  const checkNow = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    check();
    timerRef.current = setInterval(check, interval);
  }, [check, interval]);

  return { online, checking, checkNow };
}
