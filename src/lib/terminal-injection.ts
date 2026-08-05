/**
 * terminal-injection — 终端命令注入（对齐 Hermes $terminalInjection + runInTerminal）
 *
 * 场景：外部（CLI 管理的）provider 断开等——不能静默删别的工具拥有的凭据，
 * 把文档化移除命令排进活跃终端跑，用户看到实际执行了什么。
 * ELEVE 目前 provider 均为配置文件管理（无 CLI disconnect_command 场景），
 * 协议先行移植，消费侧 = UserTerminalView flush（活跃 tab + session open）。
 */
import { useSyncExternalStore } from 'react';

let injection: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeTerminalInjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTerminalInjectionSnapshot(): string | null {
  return injection;
}

/** 打开终端面板并排队一条命令（活跃 tab + session ready 后 flush，清空防重放） */
export function runInTerminal(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) return;
  injection = trimmed;
  emit();
}

export function clearTerminalInjection(): void {
  injection = null;
}

/** React 消费（对齐 Hermes useStore($terminalInjection)） */
export function useTerminalInjection(): string | null {
  return useSyncExternalStore(subscribeTerminalInjection, getTerminalInjectionSnapshot);
}
