/**
 * terminal-injection — 终端命令注入（对齐 Hermes $terminalInjection + runInTerminal）
 *
 * 场景：外部（CLI 管理的）provider 断开等——不能静默删别的工具拥有的凭据，
 * 把文档化移除命令排进活跃终端跑，用户看到实际执行了什么。
 * ELEVE 目前 provider 均为配置文件管理（无 CLI disconnect_command 场景），
 * 协议先行移植，消费侧 = UserTerminalView flush（活跃 tab + session open）。
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（导出 API 签名不变，消费方零改动）。
 */
import { createAtomStore } from './store-factory';

const store = createAtomStore<string | null>(null);

export function subscribeTerminalInjection(listener: () => void): () => void {
  return store.subscribe(listener);
}

export function getTerminalInjectionSnapshot(): string | null {
  return store.get();
}

/** 打开终端面板并排队一条命令（活跃 tab + session ready 后 flush，清空防重放） */
export function runInTerminal(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) return;
  store.set(trimmed);
}

export function clearTerminalInjection(): void {
  store.set(null);
}

/** React 消费（对齐 Hermes useStore($terminalInjection)） */
export function useTerminalInjection(): string | null {
  return store.useAtom();
}
