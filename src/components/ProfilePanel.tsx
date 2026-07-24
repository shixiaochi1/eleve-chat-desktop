/**
 * ProfilePanel — Agent 面板（多 Profile 选择器 + 新建）
 *
 * 每个 Profile（Agent 身份）一张卡片，显示 model/provider/技能数/default 徽章。
 * 点选卡片 → 切换 active profile → 通知 App 切换聊天区 + 设置上下文。
 * 底部操作栏：新建 Agent（内联表单，可选克隆配置）+ 刷新 + 统计。
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchProfiles, setActiveProfile, createProfile } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { cn } from '@/lib/utils';
import {
  Bot, Cpu, Plug, Package, Check, Star, Loader,
  Users, RefreshCw, Plus,
} from 'lucide-react';

interface ProfileCardData {
  name: string;
  path: string;
  is_default: boolean;
  is_active: boolean;
  has_env: boolean;
  model: string | null;
  provider: string | null;
  skill_count: number;
}

interface ProfilePanelProps {
  currentProfile?: string;
  onProfileChange?: (name: string) => void;
  [key: string]: unknown;
}

// ── 单个 Agent 卡片 ──
function ProfileCard({
  profile, active, switching, onSelect,
}: {
  profile: ProfileCardData;
  active: boolean;
  switching: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(profile.name)}
      disabled={switching}
      className={cn(
        'w-full text-left px-2.5 py-2 rounded-lg border transition-colors space-y-1.5',
        active
          ? 'border-primary/50 bg-accent/5'
          : 'border-border bg-card hover:bg-accent/30',
        switching && 'opacity-60'
      )}
    >
      {/* 名称行 */}
      <div className="flex items-center gap-1.5">
        <div className={cn(
          'flex items-center justify-center w-6 h-6 rounded-md shrink-0',
          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        )}>
          <Bot size={13} strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">{profile.name}</span>
        {profile.is_default && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-muted text-muted-foreground" title="默认 Agent">
            <Star size={9} strokeWidth={1.5} />
            默认
          </span>
        )}
        {switching ? (
          <Loader size={12} strokeWidth={1.5} className="animate-spin text-primary" />
        ) : active ? (
          <Check size={13} strokeWidth={2} className="text-primary" />
        ) : null}
      </div>

      {/* 元信息 */}
      <div className="flex flex-wrap items-center gap-1.5 pl-7">
        {profile.model ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="模型">
            <Cpu size={9} strokeWidth={1.5} />
            <span className="truncate max-w-[90px]">{profile.model}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">未配置模型</span>
        )}
        {profile.provider && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="提供方">
            <Plug size={9} strokeWidth={1.5} />
            <span className="truncate max-w-[70px]">{profile.provider}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="技能数">
          <Package size={9} strokeWidth={1.5} />
          <span>{profile.skill_count}</span>
        </span>
      </div>
    </button>
  );
}

// ── 主面板 ──
export default function ProfilePanel({ currentProfile, onProfileChange }: ProfilePanelProps) {
  const [profiles, setProfiles] = useState<ProfileCardData[]>([]);
  const [activeName, setActiveName] = useState<string>(currentProfile || 'default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  // ── 新建 Agent 表单状态 ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [cloneSource, setCloneSource] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data.profiles as ProfileCardData[]);
      setActiveName(data.active);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 外部 currentProfile 变化时同步高亮（App 全局状态驱动）
  useEffect(() => {
    if (currentProfile) setActiveName(currentProfile);
  }, [currentProfile]);

  const handleSelect = useCallback(async (name: string) => {
    if (name === activeName) return;
    setSwitching(name);
    try {
      await setActiveProfile(name);
      setActiveName(name);
      notifySuccess(`已切换到 Agent：${name}`);
      onProfileChange?.(name);
      void load(); // 刷新列表更新 is_active 标记
    } catch (err: unknown) {
      notifyError(err, `切换到 ${name} 失败`);
    } finally {
      setSwitching(null);
    }
  }, [activeName, onProfileChange, load]);

  const resetCreateForm = useCallback(() => {
    setCreating(false);
    setNewName('');
    setCloneSource('');
  }, []);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || creatingBusy) return;
    setCreatingBusy(true);
    try {
      await createProfile(name, cloneSource || undefined);
      notifySuccess(`Agent「${name}」已创建`);
      resetCreateForm();
      void load();
    } catch (err: unknown) {
      notifyError(err, `创建 ${name} 失败`);
    } finally {
      setCreatingBusy(false);
    }
  }, [newName, cloneSource, creatingBusy, resetCreateForm, load]);

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 错误 */}
      {error && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20 shrink-0">{error}</div>
      )}

      {/* Agent 卡片列表 */}
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">加载中...</div>
        ) : (
          profiles.map(p => (
            <ProfileCard
              key={p.name}
              profile={p}
              active={p.name === activeName}
              switching={switching === p.name}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>

      {/* 底部操作栏（替代原委托任务区） */}
      <div className="shrink-0 border-t border-border pt-2.5 space-y-2">
        {creating ? (
          /* 新建表单 */
          <div className="space-y-1.5 panel-enter">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void handleCreate(); }
                if (e.key === 'Escape') { resetCreateForm(); }
              }}
              placeholder="Agent 名称，如 coder"
              autoFocus
              disabled={creatingBusy}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <select
              value={cloneSource}
              onChange={(e) => setCloneSource(e.target.value)}
              disabled={creatingBusy}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            >
              <option value="">空白配置（不克隆）</option>
              {profiles.map(p => (
                <option key={p.name} value={p.name}>克隆自 {p.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || creatingBusy}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creatingBusy ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : <Plus size={13} strokeWidth={2.5} />}
                创建
              </button>
              <button
                onClick={resetCreateForm}
                disabled={creatingBusy}
                className="px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          /* 新建按钮 + 刷新 */
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCreating(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm"
            >
              <Plus size={14} strokeWidth={2.5} />
              新建 Agent
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="p-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
              title="刷新列表"
            >
              <RefreshCw size={13} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* 统计行 */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Users size={11} />
          共 {profiles.length} 个 Agent
          {activeName && <span className="text-muted-foreground/40">· 当前 {activeName}</span>}
        </div>
      </div>
    </div>
  );
}
