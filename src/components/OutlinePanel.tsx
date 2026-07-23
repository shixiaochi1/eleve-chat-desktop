/**
 * OutlinePanel — 消息大纲导航面板
 *
 * 提取当前对话消息的结构化大纲：
 * - User 消息 → 节标题（显示 prompt 文本，截断）
 * - Agent 消息 → 子项（显示响应预览，截断）
 * - Tool call → 嵌套在其父 Agent 下（工具名 + 状态）
 * - Reasoning → 在 Agent 消息下可折叠展开
 *
 * 点击任一项目 → dispatch 自定义事件 eleve:scroll-to-message
 * MessageContainer 监听并滚动到对应消息
 */
import { useState, useMemo, useCallback } from 'react';
import {
  MessageSquare, Wrench, Brain,
  ChevronRight, ChevronDown, List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessages } from '@/store/messages';
import type { ChatMessage, ChatMessagePart } from '@/types';

interface OutlineItemBase {
  id: string;
  label: string;
  depth: number;
  icon: string;
}

interface OutlineUserItem extends OutlineItemBase {
  type: 'user';
}

interface OutlineAgentItem extends OutlineItemBase {
  type: 'agent';
  hasReasoning: boolean;
  toolCalls: ToolCallOutline[];
}

interface OutlineReasoningItem extends OutlineItemBase {
  type: 'reasoning';
  parentId: string | null;
}

interface OutlineToolItem extends OutlineItemBase {
  type: 'tool';
  status?: string;
}

interface ToolCallOutline {
  id: string;
  toolName: string;
  status: string;
  callId?: string;
}

type OutlineItem = OutlineUserItem | OutlineAgentItem | OutlineReasoningItem | OutlineToolItem;

const ICON_SIZE = 12;
const STROKE_PROPS = { strokeWidth: 1.5, absoluteStrokeWidth: true };

/**
 * 截断字符串到指定长度
 */
function truncate(text: unknown, max = 60): string {
  if (!text) return '';
  const s = typeof text === 'string' ? text : String(text);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 构建消息大纲树
 * Parts-based: iterates m.role + m.parts instead of m.type + m.content
 */
function buildOutline(messages: ChatMessage[]): OutlineItem[] {
  const items: OutlineItem[] = [];

  messages.forEach((m: ChatMessage) => {
    // ── Parts-based path ──
    if (m.parts && m.parts.length > 0) {
      if (m.role === 'user') {
        const text = m.parts
          .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
          .map(p => p.text).join('');
        items.push({
          type: 'user',
          id: m.id,
          label: truncate(text, 50),
          depth: 0,
          icon: 'message',
        });
        return;
      }

      if (m.role === 'assistant') {
        const textParts = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text');
        const reasoningParts = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'reasoning' }> => p.type === 'reasoning');
        const toolParts = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'tool-call' }> => p.type === 'tool-call');

        const entry: OutlineAgentItem = {
          type: 'agent',
          id: m.id,
          label: truncate(textParts.map(p => p.text).join(''), 50) || '(空回复)',
          depth: 0,
          icon: 'brain',
          hasReasoning: reasoningParts.length > 0,
          toolCalls: toolParts.map(tp => ({
            id: `${m.id}-tc-${tp.toolCallId}`,
            toolName: tp.toolName || '未知工具',
            status: tp.result != null ? 'completed' : 'running',
            callId: tp.toolCallId,
          })),
        };
        items.push(entry);
        return;
      }
    }

    // ── Legacy flat-field fallback ──
    switch (m.type) {
      case 'user':
        items.push({
          type: 'user',
          id: m.id,
          label: truncate(m.content, 50),
          depth: 0,
          icon: 'message',
        });
        break;

      case 'agent': {
        const entry: OutlineAgentItem = {
          type: 'agent',
          id: m.id,
          label: truncate(m.content, 50) || '(空回复)',
          depth: 0,
          icon: 'brain',
          hasReasoning: false,
          toolCalls: [],
        };
        items.push(entry);
        break;
      }

      case 'reasoning':
        items.push({
          type: 'reasoning',
          id: m.id,
          label: truncate(m.content || m.reasoning_content, 40) || '推理过程',
          depth: 1,
          icon: 'brain',
          parentId: null,
        });
        break;

      case 'tool':
        items.push({
          type: 'tool',
          id: m.id,
          label: (m.toolName || m.tool_name || '工具') + ' · ' + (m.status || 'completed'),
          depth: 1,
          icon: 'wrench',
          status: m.status,
        });
        break;
    }
  });

  return items;
}

export default function OutlinePanel({ embedded = false }: { embedded?: boolean }) {
  const messages = useMessages();
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});

  const outline = useMemo(() => buildOutline(messages), [messages]);

  // 统计
  const stats = useMemo(() => {
    let userCount = 0;
    let assistantCount = 0;
    let toolCount = 0;
    messages.forEach((m: ChatMessage) => {
      if (m.role === 'user') userCount++;
      else if (m.role === 'assistant') {
        assistantCount++;
        toolCount += m.parts?.filter(p => p.type === 'tool-call').length ?? 0;
      }
    });
    return { total: messages.length, userCount, agentCount: assistantCount, toolCount };
  }, [messages]);

  const toggleAgent = useCallback((id: string) => {
    setExpandedAgents((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleScrollTo = useCallback((messageId: string) => {
    window.dispatchEvent(
      new CustomEvent('eleve:scroll-to-message', { detail: { messageId } })
    );
  }, []);

  // 渲染单个 outline 条目
  const renderItem = useCallback((item: OutlineItem, index: number) => {
    const agentItem = item as OutlineAgentItem;
    const isExpanded = expandedAgents[item.id];

    const iconEl = (() => {
      switch (item.icon) {
        case 'message':
          return <MessageSquare size={ICON_SIZE} {...STROKE_PROPS} />;
        case 'brain':
          return <Brain size={ICON_SIZE} {...STROKE_PROPS} />;
        case 'wrench':
          return <Wrench size={ICON_SIZE} {...STROKE_PROPS} />;
        default:
          return <MessageSquare size={ICON_SIZE} {...STROKE_PROPS} />;
      }
    })();

    return (
      <div key={item.id || index}>
        {/* 主条目（user / agent） */}
        <div
          className={cn(
            'flex items-center gap-1 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-accent/30 transition-colors',
            item.depth === 1 && 'pl-4',
            item.type === 'tool' && (item as OutlineToolItem).status === 'error' && 'text-destructive',
            item.type === 'tool' && (item as OutlineToolItem).status === 'running' && 'text-primary'
          )}
          onClick={() => handleScrollTo(item.id)}
          title={item.label}
        >
          <span className="shrink-0 text-muted-foreground">{iconEl}</span>
          <span className="truncate flex-1">{item.label}</span>
          {item.type === 'agent' && (agentItem.hasReasoning || agentItem.toolCalls.length > 0) && (
            <button
              className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleAgent(item.id); }}
              title={isExpanded ? '折叠子项' : '展开子项'}
            >
              {isExpanded
                ? <ChevronDown size={10} {...STROKE_PROPS} />
                : <ChevronRight size={10} {...STROKE_PROPS} />}
            </button>
          )}
        </div>

        {/* 折叠的子项：reasoning + tool calls */}
        {item.type === 'agent' && isExpanded && (
          <div className="ml-2">
            {agentItem.hasReasoning && (
              <div
                className="flex items-center gap-1 px-1 py-0.5 pl-4 rounded text-xs text-accent-purple cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => handleScrollTo(item.id)}
                title="推理过程"
              >
                <span className="shrink-0">
                  <Brain size={ICON_SIZE} {...STROKE_PROPS} />
                </span>
                <span className="truncate">推理过程</span>
              </div>
            )}
            {agentItem.toolCalls.map((tc: ToolCallOutline, tcIdx: number) => (
              <div
                key={tc.id || tcIdx}
                className={cn(
                  'flex items-center gap-1 px-1 py-0.5 pl-4 rounded text-xs cursor-pointer hover:bg-accent/30 transition-colors',
                  tc.status === 'error' && 'text-destructive',
                  tc.status === 'running' && 'text-primary'
                )}
                onClick={() => handleScrollTo(tc.id)}
                title={`${tc.toolName} · ${tc.status}`}
              >
                <span className="shrink-0 text-muted-foreground">
                  <Wrench size={ICON_SIZE} {...STROKE_PROPS} />
                </span>
                <span className="truncate flex-1">{truncate(tc.toolName, 20)}</span>
                <span className={cn(
                  'shrink-0 text-[10px]',
                  tc.status === 'error' ? 'text-destructive' :
                  tc.status === 'running' ? 'text-primary' : 'text-success'
                )}>
                  {tc.status || '完成'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }, [expandedAgents, handleScrollTo, toggleAgent]);

  if (messages.length === 0) {
    if (embedded) return null;
    return (
      <div className="flex flex-col h-full p-3">
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <List size={16} {...STROKE_PROPS} />
          <span className="text-xs">对话为空</span>
        </div>
      </div>
    );
  }

  if (embedded) {
    return (
      <div className="px-2 py-1.5 max-h-[40vh] overflow-y-auto">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
          <List size={10} {...STROKE_PROPS} />
          <span>消息大纲</span>
          <span className="ml-auto">{stats.total} 条</span>
        </div>
        <div className="space-y-0.5">
          {outline.map((item: OutlineItem, idx: number) => renderItem(item, idx))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 统计栏 */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-b border-border pb-1">
        <span className="flex items-center gap-0.5" title="总消息数">
          <MessageSquare size={10} {...STROKE_PROPS} />
          {stats.total}
        </span>
        <span className="flex items-center gap-0.5" title="工具调用">
          <Wrench size={10} {...STROKE_PROPS} />
          {stats.toolCount}
        </span>
      </div>

      {/* 大纲列表 */}
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {outline.map((item: OutlineItem, idx: number) => renderItem(item, idx))}
      </div>
    </div>
  );
}
