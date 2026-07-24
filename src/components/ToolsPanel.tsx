/**
 * ToolsPanel — Eleve 内置 Rust 工具列表 + 技能管理
 * 顶部 Tab 切换：工具 | 技能管理
 * 按工具集分组展示，每个工具显示名称 + 描述
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchTools, fetchToolsets, toggleToolset } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { SmallToolIcon, SearchIcon, ToolIcon } from './Icons';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import SkillsPanel from './SkillsPanel';
import { Wrench, Package, Layers } from 'lucide-react';

interface ToolItem {
  name: string;
  description: string;
  toolset?: string;
}

const TOOLSET_LABELS: Record<string, string> = {
  web: 'Web 工具',
  search: 'Web 搜索',
  terminal: '终端',
  file: '文件操作',
  code_execution: '代码执行',
  browser: '浏览器',
  vision: '视觉分析',
  skills: '技能管理',
  memory: '记忆',
  session_search: '会话搜索',
  cronjob: '定时任务',
  delegation: '子 Agent 委派',
  image_gen: '图像生成',
  tts: '语音合成',
  messaging: '消息发送',
  todo: '任务规划',
  clarify: '澄清提问',
  homeassistant: '智能家居',
  computer_use: '桌面控制',
  video: '视频分析',
  video_gen: '视频生成',
  x_search: 'X 搜索',
  spotify: 'Spotify',
  kanban: '看板协作',
  discord: 'Discord',
  discord_admin: 'Discord 管理',
  yuanbao: '元宝',
  feishu_doc: '飞书文档',
  feishu_drive: '飞书云盘',
};

// ── 工具集 Tab（对齐 Hermes SkillsView → Toolsets tab）──

interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  available: boolean;
  configured: boolean;
  tools: string[];
}

function ToolsetsTab() {
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchToolsets();
      setToolsets(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = useCallback(async (ts: ToolsetInfo, enabled: boolean) => {
    setSaving(ts.name);
    try {
      await toggleToolset(ts.name, enabled);
      // 乐观更新
      setToolsets(prev => prev.map(t => t.name === ts.name ? { ...t, enabled } : t));
      const label = TOOLSET_LABELS[ts.name] || ts.name;
      notifySuccess(`${label} 已${enabled ? '启用' : '禁用'}，对新会话生效`);
    } catch (err: unknown) {
      notifyError(err, `切换 ${ts.name} 失败`);
    } finally {
      setSaving(null);
    }
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? toolsets.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (TOOLSET_LABELS[t.name] || '').toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tools.some(tool => tool.toLowerCase().includes(q))
      )
    : toolsets;
  const enabledCount = toolsets.filter(t => t.enabled).length;

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 搜索 */}
      <div className="relative">
        <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 rounded border border-border focus:border-primary focus:outline-none placeholder:text-muted-foreground/50"
          type="text"
          placeholder="搜索工具集..."
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        />
      </div>

      {/* 统计 */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
        <Layers size={11} />
        已启用 {enabledCount}/{toolsets.length} 个工具集
      </div>

      {/* 加载/错误 */}
      {loading && (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">加载中...</div>
      )}
      {error && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">{error}</div>
      )}

      {/* 工具集列表 */}
      {!loading && !error && (
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
              {search ? '无匹配工具集' : '暂无工具集数据'}
            </div>
          ) : (
            filtered.map(ts => {
              const label = TOOLSET_LABELS[ts.name] || ts.label || ts.name;
              return (
                <div key={ts.name} className="px-1 py-2 rounded hover:bg-accent/20 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{label}</span>
                    <Switch
                      checked={ts.enabled}
                      disabled={saving === ts.name}
                      onCheckedChange={(checked: boolean) => void handleToggle(ts, checked)}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70 line-clamp-2">{ts.description}</p>
                  {ts.tools.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {ts.tools.map(tool => (
                        <span key={tool} className="px-1 py-0.5 rounded bg-muted/30 text-[9px] font-mono text-muted-foreground/60">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolsPanel() {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'tools' | 'toolsets' | 'skills'>('tools');

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

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换：工具 | 工具集 | 技能管理 */}
      <div className="flex items-center border-b border-border shrink-0">
        <button
          className={cn(
            'flex items-center gap-1.5 flex-1 justify-center px-3 py-2 text-xs font-medium transition-colors',
            activeTab === 'tools'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('tools')}
        >
          <Wrench size={13} />
          工具
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 flex-1 justify-center px-3 py-2 text-xs font-medium transition-colors',
            activeTab === 'toolsets'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('toolsets')}
        >
          <Layers size={13} />
          工具集
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 flex-1 justify-center px-3 py-2 text-xs font-medium transition-colors',
            activeTab === 'skills'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('skills')}
        >
          <Package size={13} />
          技能管理
        </button>
      </div>

      {/* ── 工具 Tab 内容 ── */}
      {activeTab === 'tools' && (
        <div className="flex flex-col h-full p-3 gap-2">
          {/* 搜索 */}
          <div className="relative">
            <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 rounded border border-border focus:border-primary focus:outline-none placeholder:text-muted-foreground/50"
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

          {/* 加载/错误状态 */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">加载中...</div>
          )}
          {error && (
            <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">{error}</div>
          )}

          {/* 工具列表 */}
          {!loading && !error && (
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {Object.keys(filteredToolsets).length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
                  {search ? '无匹配工具' : '暂无工具数据'}
                </div>
              ) : (
                Object.entries(filteredToolsets).map(([toolset, items]) => {
                  const label = TOOLSET_LABELS[toolset] || toolset;
                  const isExpanded = expanded[toolset] !== false;
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
          )}
        </div>
      )}

      {/* ── 工具集 Tab 内容（对齐 Hermes SkillsView → Toolsets）── */}
      {activeTab === 'toolsets' && <ToolsetsTab />}

      {/* ── 技能管理 Tab 内容 ── */}
      {activeTab === 'skills' && (
        <div className="flex-1 overflow-y-auto">
          <SkillsPanel />
        </div>
      )}
    </div>
  );
}
