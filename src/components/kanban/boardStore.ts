// 🔴 2026-08-16（第三轮审查 d1-R3-12）：模块级共享看板状态——对齐 Hermes
//   全局持久化原子 $boardSlug（api.ts:35,101-104）。主面板/侧边栏双
//   useKanban 实例此前各自持独立 currentBoard（一侧切板另一侧不跟随、
//   双 SSE 连接、双 60s 轮询），此 store 让板选择全局一致并持久化。
type BoardListener = (board: string) => void;

let currentBoard: string = (() => {
  try {
    return localStorage.getItem('eleve.kanban.currentBoard') || 'default';
  } catch {
    return 'default';
  }
})();

const listeners = new Set<BoardListener>();

export function getSharedBoard(): string {
  return currentBoard;
}

export function setSharedBoard(board: string): void {
  if (board === currentBoard) return;
  currentBoard = board;
  try {
    localStorage.setItem('eleve.kanban.currentBoard', board);
  } catch {
    /* localStorage 不可用时仅内存同步 */
  }
  listeners.forEach((l) => l(board));
}

/** 订阅共享看板变化，返回取消订阅函数 */
export function subscribeSharedBoard(l: BoardListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
