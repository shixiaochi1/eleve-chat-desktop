/**
 * ToolsPanel — Eleve 工具集管理 + 技能管理
 * 顶部 Tab 切换：工具集 | 技能管理
 * 工具集按开关列表展示，技能管理内嵌 SkillsPanel
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchToolsets, toggleToolset } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { getWsClient } from '../services/ws-client';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import SkillsPanel from './SkillsPanel';
import { Package, Layers } from 'lucide-react';

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

function ToolsetsTab({ currentProfile }: { currentProfile?: string }) {
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchToolsets(currentProfile);
      setToolsets(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再 load。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) void load(); })
      .catch(() => { if (!cancelled) setError('无法连接网关，请检查后端服务'); });
    return () => { cancelled = true; };
  }, [load]);

  const handleToggle = useCallback(async (ts: ToolsetInfo, enabled: boolean) => {
    setSaving(ts.name);
    try {
      await toggleToolset(ts.name, enabled, currentProfile);
      // 乐观更新
      setToolsets(prev => prev.map(t => t.name === ts.name ? { ...t, enabled } : t));
      const label = TOOLSET_LABELS[ts.name] || ts.name;
      notifySuccess(`${label} 已${enabled ? '启用' : '禁用'}，对新会话生效`);
    } catch (err: unknown) {
      notifyError(err, `切换 ${ts.name} 失败`);
    } finally {
      setSaving(null);
    }
  }, [currentProfile]);

  const enabledCount = toolsets.filter(t => t.enabled).length;

  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-2">
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
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pb-1.5">
          {toolsets.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
              暂无工具集数据
            </div>
          ) : (
            toolsets.map(ts => {
              const label = TOOLSET_LABELS[ts.name] || ts.label || ts.name;
              return (
                <div key={ts.name} className="p-2.5 rounded-lg border border-border bg-muted/10 hover:border-primary/30 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-medium text-foreground truncate">{label}</span>
                      {!ts.configured && (
                        <span className="px-1 py-0.5 text-[9px] rounded bg-warning/10 text-warning shrink-0">未配置</span>
                      )}
                    </span>
                    <Switch
                      checked={ts.enabled}
                      disabled={saving === ts.name}
                      onCheckedChange={(checked: boolean) => void handleToggle(ts, checked)}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/70 line-clamp-2 leading-relaxed">{ts.description}</p>
                  {ts.tools.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {ts.tools.map(tool => (
                        <span key={tool} className="px-1.5 py-0.5 rounded-md bg-muted/30 border border-border/50 text-[9px] font-mono text-muted-foreground/60">
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

export default function ToolsPanel({ currentProfile }: { currentProfile?: string }) {
  const [activeTab, setActiveTab] = useState<'toolsets' | 'skills'>('toolsets');

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换：工具集 | 技能管理 */}
      <div className="flex items-center border-b border-border shrink-0">
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

      {/* ── 工具集 Tab 内容（对齐 Hermes SkillsView → Toolsets）── */}
      {activeTab === 'toolsets' && <ToolsetsTab currentProfile={currentProfile} />}

      {/* ── 技能管理 Tab 内容 ── */}
      {activeTab === 'skills' && (
        <div className="flex-1 overflow-y-auto">
          <SkillsPanel />
        </div>
      )}
    </div>
  );
}
