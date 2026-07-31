/**
 * ProfilePanel — Agent 面板（多 Profile 选择器 + 新建 + 删除）
 *
 * 每个 Profile（Agent 身份）一张卡片，显示 model/provider/技能数/default 徽章。
 * 点选卡片 → 切换 active profile → 通知 App 切换聊天区 + 设置上下文。
 * 底部操作栏：新建 Agent（内联表单）+ 刷新 + 统计。
 * 删除：非 default 卡片 hover 显示垃圾桶 → 输名字强确认 → 移入回收站（可恢复）。
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchProfiles, createProfile, deleteProfile } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { cn } from '@/lib/utils';
import {
  Bot, Cpu, Plug, Package, Check, Star, Loader,
  RefreshCw, Plus, Trash2,
} from 'lucide-react';

interface ProfileCardData {
  name: string;
  display_name?: string | null;
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
  /** 🔴 宫格按钮修复：profile 列表变化时上抛数量，App 据此驱动 agentCount（消灭平行数据源） */
  onProfilesChange?: (count: number) => void;
  [key: string]: unknown;
}

// ── 单个 Agent 卡片 ──
function ProfileCard({
  profile, active, switching, onSelect, onDelete,
}: {
  profile: ProfileCardData;
  active: boolean;
  switching: boolean;
  onSelect: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(profile.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(profile.name); } }}
      className={cn(
        'group w-full text-left px-2.5 py-2 rounded-lg border transition-colors space-y-1.5 cursor-pointer',
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
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {profile.display_name || profile.name}
          {profile.display_name && profile.display_name !== profile.name && (
            <span className="ml-1 text-[10px] text-muted-foreground/60 font-normal">({profile.name})</span>
          )}
        </span>
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
        {/* 删除按钮（非 default，hover 显示） */}
        {!profile.is_default && onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile.name); }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
            title={`删除 ${profile.name}`}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
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
    </div>
  );
}

// ── 主面板 ──
export default function ProfilePanel({ currentProfile, onProfileChange, onProfilesChange }: ProfilePanelProps) {
  const [profiles, setProfiles] = useState<ProfileCardData[]>([]);
  // 🔴 高亮唯一权威源 = App 的 currentProfile（UI 焦点 ①），经 prop 下发，不读后端 active_profile（③）。
  // 决策④：UI 切换不写 ③，故 ③ 恒为系统默认（CLI 权威）；若拿 ③ 当高亮源，点选后 load() 会把高亮弹回 default。
  const activeName = currentProfile || 'default';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  // ── 新建 Agent 表单状态 ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [cloneSource, setCloneSource] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  // ── 删除 Agent 确认状态 ──
  const [deletingTarget, setDeletingTarget] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data.profiles as ProfileCardData[]);
      // 🔴 不用 data.active（③）覆盖高亮 —— ③ 是系统默认（CLI 权威），非 UI 选择源。
      // 高亮由 currentProfile prop 派生（见 activeName）；load 只刷新列表数据（model/技能数/统计）。
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 🔴 宫格按钮修复：列表数据变化（建/删/手动刷新）时上抛数量。
  // App.agentCount 为唯一持有者，初始值由 portReady fetch 兜底，运行期由此回调驱动。
  useEffect(() => { onProfilesChange?.(profiles.length); }, [profiles, onProfilesChange]);

  const handleSelect = useCallback((name: string) => {
    if (name === activeName) return;
    setSwitching(name);
    try {
      // 🔴 决策④：UI 切换 = 纯前端操作，不调后端 set_active（不写 active_profile 文件）。
      // Agent 间零共享可变状态，切换只是换显示界面。
      // 高亮不在此 setState —— onProfileChange 更新 App.currentProfile，经 prop 回流驱动 activeName（受控单向流）。
      onProfileChange?.(name);
    } finally {
      setSwitching(null);
    }
  }, [activeName, onProfileChange]);

  const resetCreateForm = useCallback(() => {
    setCreating(false);
    setNewName('');
    setNewDisplayName('');
    setCloneSource('');
  }, []);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || creatingBusy) return;
    setCreatingBusy(true);
    try {
      const dn = newDisplayName.trim() || undefined;
      await createProfile(name, dn, cloneSource || undefined);
      // 🔴 G1: 创建后自动切换到新 Agent（纯前端切换，不写后端 active_profile）。
      // 高亮经 onProfileChange → App.currentProfile → prop 回流驱动，不在此 setState。
      onProfileChange?.(name);
      notifySuccess(`Agent「${dn || name}」已创建并切换`);
      resetCreateForm();
      void load();
    } catch (err: unknown) {
      notifyError(err, `创建 ${name} 失败`);
    } finally {
      setCreatingBusy(false);
    }
  }, [newName, newDisplayName, cloneSource, creatingBusy, resetCreateForm, load, onProfileChange]);

  const cancelDelete = useCallback(() => {
    setDeletingTarget(null);
    setDeleteConfirmName('');
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deletingTarget || deleteConfirmName !== deletingTarget || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await deleteProfile(deletingTarget);
      notifySuccess(`Agent「${deletingTarget}」已移入回收站`);
      // 🔴 P1-1: 删除当前活跃 Agent 后必须回调切换（否则 currentProfile 悬空 + 盖章死 profile）
      if (deletingTarget === currentProfile) {
        onProfileChange?.('default');
      }
      cancelDelete();
      void load();
    } catch (err: unknown) {
      notifyError(err, `删除 ${deletingTarget} 失败`);
    } finally {
      setDeletingBusy(false);
    }
  }, [deletingTarget, deleteConfirmName, deletingBusy, cancelDelete, load, currentProfile, onProfileChange]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 区块头：AGENTS + 计数 + 刷新/新建 ── */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 select-none">Agents</span>
        {!loading && profiles.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/40">{profiles.length}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-40"
            title="刷新列表"
          >
            <RefreshCw size={12} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setDeletingTarget(null); setCreating(v => !v); }}
            className={cn(
              'p-1 rounded-md transition-colors',
              creating ? 'bg-accent text-accent-foreground' : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent/40'
            )}
            title="新建 Agent"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="mx-3 mb-1 px-2 py-1 text-[11px] text-destructive bg-destructive/5 rounded border border-destructive/20 shrink-0">{error}</div>
      )}

      {/* Agent 卡片列表（内部滚动，高度由 AgentsPanel 上限约束） */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1.5 min-h-0">
        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">加载中...</div>
        ) : (
          profiles.map(p => (
            <ProfileCard
              key={p.name}
              profile={p}
              active={p.name === activeName}
              switching={switching === p.name}
              onSelect={handleSelect}
              onDelete={(name) => { resetCreateForm(); setDeletingTarget(name); setDeleteConfirmName(''); }}
            />
          ))
        )}
      </div>

      {/* ── 内联表单区（新建 / 删除确认，展开时占卡片下方） ── */}
      {creating && !deletingTarget && (
          /* 新建表单 */
          <div className="shrink-0 px-3 pb-2 space-y-1.5 panel-enter">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void handleCreate(); }
                if (e.key === 'Escape') { resetCreateForm(); }
              }}
              placeholder="Agent ID（英文小写，如 coder）"
              autoFocus
              disabled={creatingBusy}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void handleCreate(); }
                if (e.key === 'Escape') { resetCreateForm(); }
              }}
              placeholder="显示名称（可选，支持中文，如「小老虎」）"
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
      )}
      {deletingTarget && (
          /* 删除强确认（输名字） */
          <div className="shrink-0 px-3 pb-2 space-y-1.5 panel-enter">
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
              <Trash2 size={12} strokeWidth={2} />
              删除 Agent「{deletingTarget}」
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              将移入回收站（可恢复）。该 Agent 自己的配置、凭证、会话、记忆一并移走，
              <span className="text-foreground/70">不影响其它 Agent</span>。
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void handleDelete(); }
                if (e.key === 'Escape') { cancelDelete(); }
              }}
              placeholder={`输入「${deletingTarget}」确认删除`}
              autoFocus
              disabled={deletingBusy}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-destructive/40 bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-destructive/50 disabled:opacity-50"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void handleDelete()}
                disabled={deleteConfirmName !== deletingTarget || deletingBusy}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deletingBusy ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : <Trash2 size={13} strokeWidth={2} />}
                删除
              </button>
              <button
                onClick={cancelDelete}
                disabled={deletingBusy}
                className="px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
              >
                取消
              </button>
            </div>
          </div>
      )}
    </div>
  );
}
