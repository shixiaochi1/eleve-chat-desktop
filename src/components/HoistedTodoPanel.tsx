import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/** todo 工具返回的待办项 */
interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

interface HoistedTodoPanelProps {
  /** todo 列表数据 */
  todos: TodoItem[];
}

/** 状态 → 图标+颜色映射 */
const STATUS_CONFIG: Record<string, { icon: string; colorClass: string }> = {
  completed: { icon: '✓', colorClass: 'text-green-500' },
  in_progress: { icon: '●', colorClass: 'text-blue-500' },
  pending: { icon: '○', colorClass: 'text-muted-foreground' },
  cancelled: { icon: '✕', colorClass: 'text-muted-foreground/50' },
};

/**
 * HoistedTodoPanel — 对齐 Hermes HoistedTodoPanel
 *
 * 将 AI 消息中的 todo 工具调用结果"提升"到消息正文上方独立展示。
 * 当前进行中的事项高亮，其余淡出。
 */
export default function HoistedTodoPanel({ todos }: HoistedTodoPanelProps) {
  if (!todos || todos.length === 0) return null;

  const hasActive = todos.some(t => t.status === 'in_progress');

  return (
    <div className="border border-border rounded-lg bg-card p-2 mb-1.5 max-w-fit">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
        <span>待办事项</span>
        <span className="text-muted-foreground/60">· {todos.length}</span>
        {hasActive && <span className="text-blue-500">（进行中）</span>}
      </div>
      <div className="space-y-0.5">
        {todos.map((todo) => {
          const config = STATUS_CONFIG[todo.status] || STATUS_CONFIG.pending;
          const isActive = todo.status === 'in_progress';
          return (
            <div
              key={todo.id}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                isActive ? 'opacity-100' : 'opacity-45',
                todo.status === 'completed' && 'line-through'
              )}
            >
              <span className={cn('shrink-0 text-[10px]', config.colorClass)}>
                {config.icon}
              </span>
              <span className="truncate">{todo.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 从消息 parts 中提取 todo 列表（对齐 Hermes todosFromMessageContent）
 *
 * 遍历消息的 tool-call parts，找到 toolName === 'todo' 的，
 * 从其结果中提取 TodoItem 数组
 */
export function todosFromMessageParts(parts: readonly { type: string; toolName?: string; result?: unknown }[]): TodoItem[] {
  const todos: TodoItem[] = [];
  for (const part of parts) {
    if (part.type !== 'tool-call' || part.toolName !== 'todo') continue;
    const result = part.result;
    if (!result || typeof result !== 'object') continue;

    // 结果可能是 { todos: [...] } 或直接是数组
    const arr = Array.isArray(result) ? result : (result as Record<string, unknown>)?.todos;
    if (!Array.isArray(arr)) continue;

    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      todos.push({
        id: String(obj.id ?? ''),
        content: String(obj.content ?? ''),
        status: (['pending', 'in_progress', 'completed', 'cancelled'].includes(obj.status as string)
          ? obj.status : 'pending') as TodoItem['status'],
      });
    }
  }
  return todos;
}
