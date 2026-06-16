/**
 * DebugPanel — 实时 SSE 事件 / 工具调用 / 会话信息
 * Apple 风格，lucide 图标替代文本标签
 */
import { useRef, useEffect, useState } from 'react';
import {
  SmallToolIcon, CheckIcon, LoadingIcon, StatusDot,
  ThinkingIcon, ModelIcon, DeleteIcon, FilterIcon, ToolIcon,
} from './Icons';
import { MessageCircle, AlertCircle, Users, Braces } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_SIZE = 11;
const strokeProps = { strokeWidth: 1.5, absoluteStrokeWidth: true };

interface DebugEvent {
  type: string;
  ts: number;
  detail?: string;
}

interface DebugToolCall {
  name: string;
  status: string;
  args?: string;
  result?: string;
}

interface DebugPanelProps {
  debugEvents?: DebugEvent[];
  debugToolCalls?: DebugToolCall[];
  tokensIn?: number;
  tokensOut?: number;
  sessionId?: string;
  messageCount?: number;
  gatewayOnline?: boolean;
  onClearEvents?: () => void;
}

interface EventConfig {
  label: string;
  color: string;
  Icon: React.ComponentType<Record<string, unknown>> | ((props: Record<string, unknown>) => React.ReactElement);
}

const EVENT_CONFIG: Record<string, EventConfig> = {
  text:      { label: '消息',    color: 'var(--accent)',   Icon: MessageCircle },
  reasoning: { label: '思考',    color: '#a78bfa',         Icon: ThinkingIcon },
  tool_start:{ label: '工具开始',color: '#f59e0b',         Icon: ToolIcon },
  tool_arg:  { label: '工具参数',color: '#f59e0b',         Icon: (s: Record<string, unknown>) => <Braces size={ICON_SIZE} {...strokeProps} {...s} /> },
  tool_complete:  { label: '工具完成',color: 'var(--success)',  Icon: CheckIcon },
  usage:     { label: '用量',    color: 'var(--accent)',   Icon: ModelIcon },
  done:      { label: '完成',    color: 'var(--success)',  Icon: CheckIcon },
  error:     { label: '错误',    color: 'var(--error)',    Icon: (s: Record<string, unknown>) => <AlertCircle size={ICON_SIZE} {...strokeProps} {...s} /> },
  delegate:  { label: '委派',    color: '#ec4899',         Icon: (s: Record<string, unknown>) => <Users size={ICON_SIZE} {...strokeProps} {...s} /> },
  model:     { label: '模型',    color: '#8b5cf6',         Icon: ModelIcon },
};

export default function DebugPanel({
  debugEvents = [],
  debugToolCalls = [],
  tokensIn = 0,
  tokensOut = 0,
  sessionId = '',
  messageCount = 0,
  gatewayOnline = false,
  onClearEvents,
}: DebugPanelProps) {
  const [tab, setTab] = useState('events');
  const [filter, setFilter] = useState<string | null>(null); // null = all
  const logRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [debugEvents, tab, autoScroll, filter]);

  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const formatTs = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const eventTypes = [...new Set(debugEvents.map((e) => e.type))];

  const filtered = filter
    ? debugEvents.filter((e) => e.type === filter)
    : debugEvents;

  const renderEvent = (ev: DebugEvent, i: number) => {
    const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--text-secondary)', Icon: null as any };
    const IconC = cfg.Icon;

    return (
      <div key={i} className="flex items-start gap-1 px-2 py-0.5 border-l-2 text-[10px]" style={{ borderLeftColor: cfg.color }}>
        <span className="shrink-0 text-muted-foreground/50 font-mono">{formatTs(ev.ts)}</span>
        <span className="shrink-0 px-0.5 rounded" style={{ color: cfg.color, border: `1px solid ${cfg.color}` }}>
          {IconC && <IconC size={ICON_SIZE} />}
        </span>
        <span className="flex-1 text-foreground/70 truncate">{ev.detail}</span>
      </div>
    );
  };

  const renderTool = (t: DebugToolCall, i: number) => (
    <div key={i} className="px-2 py-1 rounded border border-border mb-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-medium text-foreground">
          <SmallToolIcon size={12} className="text-muted-foreground" />
          {t.name}
        </span>
        <span className={cn(
          'flex items-center',
          t.status === 'done' ? 'text-green-500' :
          t.status === 'pending' ? 'text-accent' : 'text-destructive'
        )}>
          {t.status === 'done' ? <CheckIcon size={12} /> : t.status === 'pending' ? <LoadingIcon size={12} className="animate-spin" /> : <DeleteIcon size={12} />}
        </span>
      </div>
      {t.args && (
        <details className="mt-1">
          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">参数</summary>
          <pre className="text-[10px] text-muted-foreground/70 mt-0.5 p-1 bg-muted/30 rounded overflow-x-auto">{t.args}</pre>
        </details>
      )}
      {t.result && (
        <details className="mt-1">
          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">结果</summary>
          <pre className="text-[10px] text-muted-foreground/70 mt-0.5 p-1 bg-muted/30 rounded overflow-x-auto">{t.result}</pre>
        </details>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full p-3">
      {/* 标签 */}
      <div className="flex items-center gap-0.5 border-b border-border mb-2">
        <button className={cn(
          'px-2 py-1 text-xs border-b-2 border-transparent transition-colors',
          tab === 'events' ? 'border-accent text-accent' : 'text-muted-foreground hover:text-foreground'
        )} onClick={() => setTab('events')}>
          事件 {debugEvents.length > 0 && `(${debugEvents.length})`}
        </button>
        <button className={cn(
          'px-2 py-1 text-xs border-b-2 border-transparent transition-colors',
          tab === 'tools' ? 'border-accent text-accent' : 'text-muted-foreground hover:text-foreground'
        )} onClick={() => setTab('tools')}>
          工具 {debugToolCalls.length > 0 && `(${debugToolCalls.length})`}
        </button>
        <button className={cn(
          'px-2 py-1 text-xs border-b-2 border-transparent transition-colors',
          tab === 'info' ? 'border-accent text-accent' : 'text-muted-foreground hover:text-foreground'
        )} onClick={() => setTab('info')}>
          信息
        </button>
      </div>

      {/* 过滤栏 (仅事件 tab) */}
      {tab === 'events' && eventTypes.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap mb-2">
          <FilterIcon size={10} className="text-muted-foreground shrink-0" />
          <button className={cn(
            'px-1 py-0.5 text-[10px] rounded transition-colors',
            filter === null ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/30'
          )}
            onClick={() => setFilter(null)}>全部</button>
          {eventTypes.map((type) => (
            <button key={type} className={cn(
              'px-1 py-0.5 text-[10px] rounded transition-colors',
              filter === type ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/30'
            )}
              onClick={() => setFilter(type)}>{EVENT_CONFIG[type]?.label || type}</button>
          ))}
          <button className="ml-auto p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors" title="清空"
            onClick={() => { onClearEvents?.(); }}>
            <DeleteIcon size={12} />
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto space-y-0.5" ref={logRef} onScroll={handleScroll}>
        {tab === 'events' && (
          filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[10px] text-muted-foreground/50">{filter ? '无匹配事件' : '等待 SSE 事件...'}</div>
          ) : (
            filtered.map(renderEvent)
          )
        )}

        {tab === 'tools' && (
          debugToolCalls.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[10px] text-muted-foreground/50">暂无工具调用</div>
          ) : (
            debugToolCalls.map(renderTool)
          )
        )}

        {tab === 'info' && (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">会话 ID</span>
              <span className="text-foreground font-mono text-[10px]" title={sessionId}>{sessionId?.slice(0, 16) || '—'}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">消息数</span>
              <span className="text-foreground">{messageCount}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">输入 Tokens</span>
              <span className="text-foreground">{tokensIn.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">输出 Tokens</span>
              <span className="text-foreground">{tokensOut.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">网关状态</span>
              <span className={cn(
                'flex items-center gap-1',
                gatewayOnline ? 'text-green-500' : 'text-destructive'
              )}>
                <StatusDot size={8} fill={gatewayOnline ? 'var(--success)' : 'var(--error)'} />
                {gatewayOnline ? '在线' : '离线'}
              </span>
            </div>
          </div>
        )}
      </div>

      {!autoScroll && tab === 'events' && (
        <button className="absolute bottom-2 right-2 px-2 py-0.5 text-[10px] bg-background border border-border rounded shadow-sm text-accent hover:bg-accent/10 transition-colors" onClick={() => { setAutoScroll(true); if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }}>
          ↓ 最新
        </button>
      )}
    </div>
  );
}
