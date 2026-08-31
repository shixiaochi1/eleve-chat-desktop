/**
 * agent-terminal-stream — Agent 后台进程输出实时流（对齐 Hermes agent-terminal-stream.ts）
 *
 * 后端 `agent.terminal.output` 事件（ProcessRegistry 输出 channel → Gateway 路由）
 * 直写只读 xterm，不再依赖轮询尾窗。三层数据：
 * - writers：已挂载终端的写入句柄（按 process_id 键控）
 * - backlog：每进程封顶 256KB 的历史缓冲 — 中途打开的 tab 回放、关闭重开恢复
 * - lastSnapshots：process.list 快照对账基准（旧网关/事件竞态兜底，前缀比对：
 *   延伸 → 只补 delta；滚动尾窗滑动 → \x1bc 重置重写）
 */

type Writer = (chunk: string) => void;

const writers = new Map<string, Writer>();
const backlog = new Map<string, string>();
const commandHeaders = new Map<string, string>();
const lastSnapshots = new Map<string, string>();
const seededCommands = new Set<string>();

const MAX_BACKLOG = 256_000;

/** 挂载中的 agent 终端注册 xterm 写入句柄并回放 backlog；返回幂等注销 */
export function registerAgentTerminalWriter(procId: string, write: Writer): () => void {
  writers.set(procId, write);

  const history = backlog.get(procId);
  if (history) {
    write(history);
  }

  return () => {
    if (writers.get(procId) === write) {
      writers.delete(procId);
    }
  };
}

/** 追加流式 chunk：入 backlog（封顶）+ 写入挂载中的终端 */
export function writeAgentTerminalChunk(procId: string, chunk: string): void {
  if (!procId || !chunk) return;

  const next = (backlog.get(procId) ?? '') + chunk;
  backlog.set(procId, next.length > MAX_BACKLOG ? next.slice(-MAX_BACKLOG) : next);
  writers.get(procId)?.(chunk);
}

/** 立即 seed 命令头 — agent 终端不会在 stdout 未到时显示空白（一次性） */
export function seedAgentTerminalCommand(procId: string, command: string): void {
  const trimmed = command.trim();
  if (!procId || !trimmed || seededCommands.has(procId)) return;

  seededCommands.add(procId);
  const header = `$ ${trimmed}\r\n`;
  commandHeaders.set(procId, header);
  writeAgentTerminalChunk(procId, header);
}

/** 消费 process.list 的全量快照（兜底/补种）：
 * - 与上次快照/当前正文一致 → 无操作
 * - 是前缀延伸 → 只写 delta
 * - 尾窗已滑动（后端 rolling buffer 截断）→ \x1bc 重置 + 重写全量尾窗 */
export function syncAgentTerminalSnapshot(procId: string, output: string): void {
  if (!procId || !output) return;

  const current = backlog.get(procId) ?? '';
  const header = commandHeaders.get(procId) ?? '';
  const body = header && current.startsWith(header) ? current.slice(header.length) : current;
  const previous = lastSnapshots.get(procId) ?? '';

  if (output === previous || output === body || body.endsWith(output)) {
    lastSnapshots.set(procId, output);
    return;
  }

  if (output.startsWith(previous)) {
    writeAgentTerminalChunk(procId, output.slice(previous.length));
    lastSnapshots.set(procId, output);
    return;
  }

  if (output.startsWith(body)) {
    writeAgentTerminalChunk(procId, output.slice(body.length));
    lastSnapshots.set(procId, output);
    return;
  }

  const next = `${header}${output}`.slice(-MAX_BACKLOG);
  lastSnapshots.set(procId, output);
  backlog.set(procId, next);
  writers.get(procId)?.(`\x1bc${next}`);
}

/**
 * 🔴 2026-09-01 内存修复（审查 P1-1）：进程级缓冲释放。
 * 此前本模块 4 个 Map + 1 个 Set 只有写入、无任何删除——每个跑过的后台进程
 * 驻留 backlog(≤256KB) + lastSnapshots（同量级）+ 命令头，直到刷新页面才
 * 释放，随历史进程数稳定累积。进程退出（terminal.close）后这些缓冲不再被
 * 任何路径消费，全部释放。已打开 tab 的 xterm buffer 独立持有显示内容，
 * 不受影响；进程已死，重开 tab 不回放（回放价值归零）。幂等。
 * 挂点：lib/global-events.ts case 'terminal.close'（单视图/宫格共享汇聚点）。
 */
export function releaseAgentTerminal(procId: string): void {
  if (!procId) return;
  writers.delete(procId);
  backlog.delete(procId);
  commandHeaders.delete(procId);
  lastSnapshots.delete(procId);
  seededCommands.delete(procId);
}
