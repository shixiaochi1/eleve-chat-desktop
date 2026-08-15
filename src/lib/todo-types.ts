/**
 * 共享 TodoItem 类型 — 单一真相源（TodoPanel / HoistedTodoPanel 复用）。
 * 对齐 DSH packages/client/tool-todo client TodoItem + ELEVE 后端
 * eleve-tools-native/src/todo.rs TodoItem（VALID_STATUSES 含 cancelled）。
 */
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}