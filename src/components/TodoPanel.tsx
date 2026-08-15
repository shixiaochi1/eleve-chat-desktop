/**
 * TodoPanel — 任务状态折叠条（对齐 DSH ui-conversation skeleton/TodoPanel）
 *
 * 🔴 2026-08-16 老大需求：DSH 前端任务执行时输入框上方有"任务状态折叠条"，
 * ELEVE 只有消息内嵌 HoistedTodoPanel，输入框上方 dock 缺失。
 * DSH 基准：packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx
 * ——可折叠（collapsed 默认 true）、header 摘要 "done n · active n · pending n"
 * （零计数段省略）、展开列表 3 色状态 glyph（completed 绿 ✓ / in_progress 蓝
 * 旋转环 / pending 虚线环）、空列表不渲染。
 *
 * 布局契约（对齐现有 GoalBar 卡片形态）：
 * - 普通文档流（非 overlay）：消息区 → 附件缩略图 → 本框 → 输入框；
 * - 数据源 = todo.status WS RPC（轮询 3s，同 GoalBar 节奏）；
 * - 会话切换即清空重拉。
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, ListChecks, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import type { TodoItem } from '../lib/todo-types';

const POLL_MS = 3000;

/** 每个状态的计数（DSH progressLabel 语义：零计数段省略，用 U+2002 分隔） */
function progressLabel(todos: readonly TodoItem[]): string {
  const done = todos.filter((item) => item.status === 'completed').length;
  const active = todos.filter((item) => item.status === 'in_progress').length;
  const pending = todos.length - done - active;
  return [
    ...(done > 0 ? [`已完成 ${done}`] : []),
    ...(active > 0 ? [`进行中 ${active}`] : []),
    ...(pending > 0 ? [`待办 ${pending}`] : []),
  ].join('\u2002·\u2002');
}

/** 状态 glyph —— 对齐 DSH 3 色状态圆环 */
function StatusGlyph({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} className="text-success" />;
    case 'in_progress':
      return <Loader2 size={13} className="animate-spin text-primary" />;
    case 'pending':
      return <Circle size={13} className="text-muted-foreground/50" strokeDasharray="2.4 2.4" />;
    default:
      return <Circle size={13} className="text-muted-foreground/50" strokeDasharray="2.4 2.4" />;
  }
}

export default function TodoPanel({ sessionId }: { sessionId?: string | null }) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await call('todo_status', { session_id: sessionId });
      setTodos(res?.todos ?? []);
    } catch {
      // 静默（会话 DB 未就绪等）
    }
  }, [sessionId]);

  // 轮询 + 切会话即时刷新
  useEffect(() => {
    setTodos([]);
    setCollapsed(true);
    if (!sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, refresh]);

  // DSH: 空列表不渲染
  if (todos.length === 0) return null;

  return (
    <div className="mx-1 mb-1 rounded-lg border border-border bg-muted/30">
      <div className="px-2.5 py-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2.5"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="shrink-0 text-muted-foreground/70" aria-hidden>
            <ListChecks size={13} />
          </span>
          <span className="shrink-0 text-[12px] font-medium text-foreground">任务计划</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
            {progressLabel(todos)}
          </span>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden>
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>
        {!collapsed && (
          <ul className="mt-1.5 flex max-h-[180px] flex-col gap-1.5 overflow-y-auto">
            {todos.map((item) => (
              <li key={item.id || item.content} className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
                  <StatusGlyph status={item.status} />
                </span>
                <span className="min-w-0 truncate text-[11px] text-foreground/80">{item.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}