/**
 * ToolsPanel — Eleve 内置 Rust 工具列表
 * 按工具集分组展示，每个工具显示名称 + 描述
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchTools } from '../utils/api';
import { SmallToolIcon, SearchIcon, ToolIcon } from './Icons';
import { cn } from '@/lib/utils';

interface ToolItem {
  name: string;
  description: string;
  toolset?: string;
}

const TOOLSET_LABELS: Record<string, string> = {
  web: 'Web 工具',
  terminal: '终端',
  file: '文件操作',
  coding: '代码执行',
  browser: '浏览器',
  vision: '视觉分析',
  skills: '技能管理',
  memory: '记忆与会话',
  builtin: '内置核心',
  cronjob: '定时任务',
  delegation: '子 Agent 委派',
  image_gen: '图像生成',
  tts: '语音合成',
};

export default function ToolsPanel() {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    fetchTools()
      .then((data: ToolItem[]) => setTools(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // 按 toolset 分组
  const grouped = tools.reduce<Record<string, ToolItem[]>>((acc, tool) => {
    const ts = tool.toolset || 'other';
    if (!acc[ts]) acc[ts] = [];
    acc[ts].push(tool);
    return acc;
  }, {});

  const toolsetOrder = Object.keys(TOOLSET_LABELS).filter((k) => grouped[k]);

  const filteredToolsets: Record<string, ToolItem[]> = search.trim()
    ? Object.fromEntries(
        Object.entries(grouped).map(([ts, items]) => [
          ts,
          items.filter((t) =>
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            t.description.toLowerCase().includes(search.toLowerCase())
          ),
        ]).filter(([, items]) => items.length > 0)
      )
    : grouped;

  const toggleExpand = (ts: string) => {
    setExpanded((prev) => ({ ...prev, [ts]: !prev[ts] }));
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full p-3">
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full p-3">
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 搜索 */}
      <div className="relative">
        <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 rounded border border-border focus:border-accent focus:outline-none placeholder:text-muted-foreground/50"
          type="text"
          placeholder="搜索工具..."
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        />
      </div>

      {/* 统计 */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
        <ToolIcon size={11} />
        {tools.length} 个工具 · {Object.keys(grouped).length} 个工具集
      </div>

      {/* 工具列表 */}
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {Object.keys(filteredToolsets).length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
            {search ? '无匹配工具' : '暂无工具数据'}
          </div>
        ) : (
          Object.entries(filteredToolsets).map(([toolset, items]) => {
            const label = TOOLSET_LABELS[toolset] || toolset;
            const isExpanded = expanded[toolset] !== false; // 默认展开
            return (
              <div key={toolset}>
                <button
                  className="flex items-center gap-1 w-full px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleExpand(toolset)}
                >
                  <span className="flex-1 text-left font-medium">{label}</span>
                  <span className="text-[10px] text-muted-foreground/50">{(items as any[]).length}</span>
                  <span className={cn(
                    'text-muted-foreground/40 transition-transform',
                    isExpanded && 'rotate-90'
                  )}>
                    &#8250;
                  </span>
                </button>
                {isExpanded && (
                  <div className="space-y-0.5 ml-1">
                    {(items as any[]).map((tool: ToolItem) => (
                      <div key={tool.name} className="px-2 py-1 rounded hover:bg-accent/30 transition-colors">
                        <div className="flex items-center gap-1 text-xs text-foreground">
                          <SmallToolIcon size={10} className="text-muted-foreground shrink-0" />
                          <span>{tool.name}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-2">{tool.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
