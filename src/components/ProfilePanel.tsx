/**
 * ProfilePanel — 多 Profile 面板（F9+ Profile 选择器）
 *
 * 替代原 "Agent 协作" 面板。永久多 Profile 模式：
 * - 每个 Profile（Agent 身份）一张卡片，显示 model/provider/技能数/default 徽章
 * - 点选卡片 → 切换 active profile → 通知 App 切换聊天区 + 设置上下文
 * - 底部折叠区保留当前会话的委托任务监控（决策 B）
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchProfiles, setActiveProfile } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import useAgents from '../hooks/useAgents';
import { DelegateCard, type DelegateTaskData } from './AgentPanel';
import { call } from '../utils/bridge';
import { cn } from '@/lib/utils';
import {
  Bot, Cpu, Plug, Package, Check, Star, Loader,
  ChevronDown, ChevronRight, Users, Send, RefreshCw,
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

interface MonitorState {
  modelName?: string;
  delegateTasks?: Record<string, DelegateTaskData>;
}

interface ProfilePanelProps {
  currentProfile?: string;
  onProfileChange?: (name: string) => void;
  monitorState?: MonitorState;
  sessionId?: string | null;
  [key: string]: unknown;
}

// ── 单个 Profile 卡片 ──
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
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-muted text-muted-foreground" title="默认 Profile">
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
export default function ProfilePanel({ currentProfile, onProfileChange, monitorState, sessionId }: ProfilePanelProps) {
  const [profiles, setProfiles] = useState<ProfileCardData[]>([]);
  const [activeName, setActiveName] = useState<string>(currentProfile || 'default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [delegateOpen, setDelegateOpen] = useState(false);

  // 委托任务（决策 B：保留当前会话 delegate 监控）
  const { activeDelegates, completedDelegates, totalActive, totalAll } = useAgents(monitorState || { delegateTasks: {} });
  const [steerText, setSteerText] = useState('');
  const [steering, setSteering] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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

  // 出现活跃委托时自动展开折叠区
  useEffect(() => {
    if (totalActive > 0) setDelegateOpen(true);
  }, [totalActive]);

  const handleSelect = useCallback(async (name: string) => {
    if (name === activeName) return;
    setSwitching(name);
    try {
      await setActiveProfile(name);
      setActiveName(name);
      notifySuccess(`已切换到 Profile：${name}`);
      onProfileChange?.(name);
      void load(); // 刷新列表更新 is_active 标记
    } catch (err: unknown) {
      notifyError(err, `切换到 ${name} 失败`);
    } finally {
      setSwitching(null);
    }
  }, [activeName, onProfileChange, load]);

  const handleSteer = useCallback(async () => {
    if (!steerText.trim() || !sessionId) return;
    setSteering(true);
    try {
      await call('steer_session', { session_id: sessionId, text: steerText.trim() });
      setSteerText('');
    } catch (e) {
      console.error('[ProfilePanel] steer failed:', e);
    } finally {
      setSteering(false);
    }
  }, [steerText, sessionId]);

  const handleCancel = useCallback(async (taskId: string) => {
    setCancellingId(taskId);
    try {
      await call('abort_chat', { session_id: taskId });
    } catch (e) {
      console.error('[ProfilePanel] cancel failed:', e);
    } finally {
      setCancellingId(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* 头部 + 刷新 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Users size={11} />
          共 {profiles.length} 个 Profile
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
          title="刷新列表"
        >
          <RefreshCw size={12} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 错误 */}
      {error && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20 shrink-0">{error}</div>
      )}

      {/* Profile 卡片列表 */}
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

      {/* 底部折叠区：委托任务监控（决策 B） */}
      <div className="shrink-0 border-t border-border pt-2 space-y-1.5">
        <button
          onClick={() => setDelegateOpen(o => !o)}
          className="flex items-center gap-1.5 w-full text-xs font-medium text-foreground hover:text-primary transition-colors"
        >
          {delegateOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Users size={12} strokeWidth={1.5} />
          <span>委托任务</span>
          {totalActive > 0 && (
            <span className="px-1 py-0.5 text-[10px] rounded bg-accent/10 text-primary">{totalActive} 活跃</span>
          )}
        </button>

        {delegateOpen && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {totalAll === 0 ? (
              <div className="text-[10px] text-muted-foreground/50 py-2 text-center">暂无活跃的委托任务</div>
            ) : (
              <>
                {activeDelegates.map((t: DelegateTaskData) => (
                  <DelegateCard key={t.id} task={t} onCancel={handleCancel} cancelling={cancellingId === t.id} />
                ))}
                {completedDelegates.map((t: DelegateTaskData) => (
                  <DelegateCard key={t.id} task={t} />
                ))}
              </>
            )}

            {/* Steer 输入 */}
            <div className="flex items-center gap-1 pt-1">
              <input
                type="text"
                value={steerText}
                onChange={(e) => setSteerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSteer(); } }}
                placeholder={sessionId ? '输入 /steer 指令…' : '无活跃会话'}
                disabled={!sessionId || steering}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <button
                onClick={handleSteer}
                disabled={!steerText.trim() || !sessionId || steering}
                className="shrink-0 p-1.5 rounded text-primary hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="发送"
              >
                {steering ? <Loader size={13} strokeWidth={1.5} className="animate-spin" /> : <Send size={13} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
