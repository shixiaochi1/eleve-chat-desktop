/**
 * SkillsPanel — 技能管理
 * Apple 风格，lucide 图标，适配 260px 面板
 * 
 * v2: 所有 API 调用走 bridge.call()，不再直接 fetch
 * v3: 已安装 Tab 只显示已安装技能（Hub 安装 + 本地合并）；自定义源管理移到 Hub Tab
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { SkillInfo } from '@/types/eleve';
import { Switch } from './ui/switch';
import { notifyError } from '../utils/notifications';
import {
  PackageIcon, SearchIcon, GlobeIcon,
  DeleteIcon, NewIcon,
} from './Icons';

interface SkillItem extends SkillInfo {
  trust_level?: string;
  source?: string;
  identifier?: string;
  install_path?: string;
}

interface TapItem {
  repo: string;
  path?: string;
}

const TRUST_LABELS: Record<string, { label: string; cls: string }> = {
  builtin:   { label: '官方',    cls: 'bg-info/10 text-info' },
  trusted:   { label: '可信',    cls: 'bg-success/10 text-success' },
  community: { label: '社区',    cls: 'bg-warning/10 text-warning' },
};

function trustBadge(level: string | undefined, source: string | undefined) {
  if (source === 'official') return <span className="px-1.5 py-0.5 text-[10px] rounded bg-info/10 text-info">官方</span>;
  const t = TRUST_LABELS[level || ''] || { label: level || '', cls: '' };
  return t.label ? <span className={cn('px-1.5 py-0.5 text-[10px] rounded', t.cls)}>{t.label}</span> : null;
}

/**
 * Hub 技能卡片 — 搜索结果与 featured 落地页共用
 * （功能对齐 Hermes SkillsPage hub browser 卡片：名称/信任徽标/描述/安装按钮/已安装徽标）
 */
function HubSkillCard({ r, installing, installMsg, installed, onInstall }: {
  r: SkillItem;
  installing?: Record<string, boolean>;
  installMsg?: Record<string, string>;
  installed: boolean;
  onInstall?: (identifier: string) => void;
}) {
  const id = r.identifier || '';
  return (
    <div className="p-2 rounded border border-[var(--ui-stroke-tertiary)]">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-xs text-foreground truncate flex-1">{r.name}</span>
        {trustBadge(r.trust_level, r.source)}
      </div>
      <div className="text-[10px] text-muted-foreground/60 mb-1">{r.description || '(无描述)'}</div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50 truncate">{r.source} — {id}</span>
        {installed ? (
          <span className="px-2 py-0.5 text-[10px] rounded bg-success/10 text-success shrink-0">已安装</span>
        ) : onInstall ? (
          <button
            className="px-2 py-0.5 text-[10px] bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
            disabled={installing?.[id] || installMsg?.[id] === 'ok'}
            onClick={() => onInstall(id)}>
            {installing?.[id] ? '安装中...' : installMsg?.[id] === 'ok' ? '已安装' : '安装'}
          </button>
        ) : null}
      </div>
      {installMsg?.[id] && installMsg[id] !== 'ok' && (
        <div className="text-[10px] text-destructive mt-1">{installMsg[id]}</div>
      )}
    </div>
  );
}

export default function SkillsPanel({ currentProfile }: { currentProfile?: string }) {
  const [tab, setTab] = useState('installed');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkillItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installMsg, setInstallMsg] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<SkillItem[]>([]);
  const [localSkills, setLocalSkills] = useState<SkillItem[]>([]);
  const [instLoading, setInstLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [taps, setTaps] = useState<TapItem[]>([]);
  const [tapRepo, setTapRepo] = useState('');
  const [tapMsg, setTapMsg] = useState('');
  // 🔴 2026-09-05 Hub 落地页（功能对齐 Hermes SkillsPage：featured + installed 徽标）
  const [featured, setFeatured] = useState<SkillItem[]>([]);
  const [installedMap, setInstalledMap] = useState<Record<string, { name?: string }>>({});
  const [searched, setSearched] = useState(false);
  const [timedOut, setTimedOut] = useState<string[]>([]);

  useEffect(() => { refreshInstalled(); refreshLocal(); refreshTaps(); refreshSources(); }, []);

  const refreshInstalled = useCallback(async () => {
    setInstLoading(true);
    try {
      const data: SkillItem[] = await call('list_hub_skills', {});
      setInstalled(Array.isArray(data) ? data : []);
    } catch { setInstalled([]); }
    setInstLoading(false);
  }, []);

  const refreshLocal = useCallback(async () => {
    setLocalLoading(true);
    try {
      const data: SkillItem[] = await call('list_skills', {});
      setLocalSkills(Array.isArray(data) ? data : []);
    } catch { setLocalSkills([]); }
    setLocalLoading(false);
  }, []);

  const refreshTaps = useCallback(async () => {
    try {
      const data: TapItem[] = await call('list_hub_taps', {});
      setTaps(Array.isArray(data) ? data : []);
    } catch { setTaps([]); }
  }, []);

  // Hub 落地页：sources + featured + installed 映射（功能对齐 Hermes getSkillHubSources）
  const refreshSources = useCallback(async () => {
    try {
      const data = await call('list_hub_sources', {});
      setFeatured(Array.isArray(data?.featured) ? data.featured : []);
      setInstalledMap(
        data?.installed && typeof data.installed === 'object' && !Array.isArray(data.installed)
          ? data.installed
          : {},
      );
    } catch {
      // 落地页失败保持空态（对齐 Hermes："leave landing minimal on failure"）
      setFeatured([]);
    }
  }, []);

  const doSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearched(true);
    try {
      // 功能对齐 Hermes searchSkillsHub 返回 {results, source_counts, timed_out}；
      // 兼容旧数组形状（老后端）
      const data = await call('search_skills_hub', { query, limit: 15 });
      const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setResults(items);
      setTimedOut(Array.isArray(data?.timed_out) ? data.timed_out : []);
      if (data?.installed && typeof data.installed === 'object' && !Array.isArray(data.installed)) {
        setInstalledMap((prev) => ({ ...prev, ...data.installed }));
      }
    } catch (err: unknown) {
      setSearchError((err as Error).message);
      setResults([]);
    }
    setSearching(false);
  }, [query]);

  const doInstall = useCallback(async (identifier: string, name: string) => {
    setInstalling((prev) => ({ ...prev, [identifier]: true }));
    setInstallMsg((prev) => ({ ...prev, [identifier]: '' }));
    try {
      const data: { ok?: boolean; error?: string } = await call('install_skill', { identifier });
      if (data?.ok) {
        setInstallMsg((prev) => ({ ...prev, [identifier]: 'ok' }));
        refreshInstalled();
        refreshSources();
      } else {
        setInstallMsg((prev) => ({ ...prev, [identifier]: `failed: ${data?.error || 'unknown'}` }));
      }
    } catch (err: unknown) {
      setInstallMsg((prev) => ({ ...prev, [identifier]: `failed: ${(err as Error).message}` }));
    }
    setInstalling((prev) => ({ ...prev, [identifier]: false }));
  }, [refreshInstalled, refreshSources]);

  const doTapAction = useCallback(async (action: string, repo: string) => {
    setTapMsg('');
    if (!repo.trim() && action !== 'list') return;
    try {
      const data: { ok?: boolean; error?: string } = await call('manage_hub_tap', { action, repo: repo.trim() });
      if (data?.ok) {
        setTapMsg(action === 'add' ? `已添加 ${repo}` : `已移除 ${repo}`);
        setTapRepo('');
        refreshTaps();
      } else {
        setTapMsg(repo ? `${repo} ${action === 'add' ? '已存在' : '未找到'}` : '操作失败');
      }
    } catch (err: unknown) {
      setTapMsg((err as Error).message);
    }
  }, [refreshTaps]);

  const handleToggleSkill = useCallback(async (skill: SkillItem, enabled: boolean) => {
    // 🔴 乐观更新（对齐 Hermes handleToggleSkill 模式）
    setInstalled(prev => prev.map(s => s.name === skill.name ? { ...s, enabled } : s));
    setLocalSkills(prev => prev.map(s => s.name === skill.name ? { ...s, enabled } : s));
    
    try {
      await call('skills.toggle', { name: skill.name, enabled, profile: currentProfile });
    } catch (err: unknown) {
      // 错误回滚
      setInstalled(prev => prev.map(s => s.name === skill.name ? { ...s, enabled: !enabled } : s));
      setLocalSkills(prev => prev.map(s => s.name === skill.name ? { ...s, enabled: !enabled } : s));
      notifyError(err, `切换 ${skill.name} 失败`);
    }
  }, [currentProfile]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') doSearch(); };

  const isInstalled = useCallback(
    (s: SkillItem) => Boolean(s.identifier && installedMap[s.identifier]),
    [installedMap],
  );

  const allSkills = [...installed, ...localSkills];

  return (
    <div className="p-2 space-y-2">
      {/* Tabs */}
      <div className="flex gap-0.5 bg-muted/20 rounded p-0.5">
        <button className={cn('flex items-center gap-1 flex-1 px-2 py-1 text-xs rounded transition-colors', tab === 'installed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => setTab('installed')}>
          <PackageIcon size={13} /> 已安装
        </button>
        <button className={cn('flex items-center gap-1 flex-1 px-2 py-1 text-xs rounded transition-colors', tab === 'hub' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => setTab('hub')}>
          <SearchIcon size={13} /> Hub
        </button>
      </div>

      {/* Tab: Installed — 已安装技能（Hub 安装 + 本地技能合并展示） */}
      {tab === 'installed' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <PackageIcon size={12} /> 已安装技能 ({allSkills.length})
          </div>
          {instLoading || localLoading ? (
            <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">加载中...</div>
          ) : allSkills.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">
              <span>暂无已安装技能</span>
              <span className="text-[10px] text-muted-foreground/50">切换到 Hub 标签搜索安装</span>
            </div>
          ) : (
            <div className="space-y-1">
              {allSkills.map((s, i) => (
                <div key={i} className="p-2 rounded border border-[var(--ui-stroke-tertiary)]">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-xs text-foreground truncate flex-1">{s.name || '?'}</span>
                    {s.category && <span className="px-1 py-0.5 text-[10px] bg-muted/30 text-muted-foreground rounded">{s.category}</span>}
                    {trustBadge(s.trust_level, s.source)}
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(checked: boolean) => void handleToggleSkill(s, checked)}
                    />
                  </div>
                  {s.description && <div className="text-[10px] text-muted-foreground/60">{s.description}</div>}
                  {(s.source || s.install_path) && (
                    <div className="text-[10px] text-muted-foreground/50">
                      {s.source && <span>source: {s.source}</span>}
                      {s.install_path && (
                        <span className="ml-1"> | {typeof s.install_path === 'object'
                          ? (s.install_path as unknown as { get: (k: string) => string })?.get('install_path')
                          : s.install_path}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Hub */}
      {tab === 'hub' && (
        <div className="space-y-2">
          {/* 自定义源 */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><GlobeIcon size={12} /> 自定义源</div>
            <div className="flex items-center gap-1">
              <input className="flex-1 px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" placeholder="owner/repo"
                value={tapRepo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTapRepo(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && doTapAction('add', tapRepo)} />
              <button className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" onClick={() => doTapAction('add', tapRepo)}>
                <NewIcon size={12} />
              </button>
              <button className="p-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={() => doTapAction('remove', tapRepo)}>
                <DeleteIcon size={12} />
              </button>
            </div>
            {tapMsg && <div className="text-[10px] text-muted-foreground/60">{tapMsg}</div>}
            {taps.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {taps.map((t, i) => (
                  <span key={i} className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted/20 text-muted-foreground rounded cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors" title={`path: ${t.path}`}
                    onClick={() => { setTapRepo(t.repo); doTapAction('remove', t.repo); }}>
                    <PackageIcon size={11} />{t.repo}<DeleteIcon size={10} />
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 搜索 */}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><SearchIcon size={12} /> 搜索 Skills Hub</div>
          <div className="flex items-center gap-1">
            <input className="flex-1 px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" placeholder="搜索技能..."
              value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} onKeyDown={handleKeyDown} />
            <button className="px-2 py-1 text-xs bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors disabled:opacity-50" onClick={doSearch} disabled={searching}>
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>

          {searchError && <div className="text-xs text-destructive">{searchError}</div>}

          {/* 单源超时可见化（功能对齐 Hermes search 返回 timed_out，不再无声空白） */}
          {timedOut.length > 0 && (
            <div className="text-[10px] text-muted-foreground/70">部分源超时：{timedOut.join('、')}（结果可能不全，可重试）</div>
          )}

          {!searched ? (
            /* 落地页：featured 技能（功能对齐 Hermes SkillsPage "Landing: featured skills (before any search)"）*/
            <>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <PackageIcon size={12} /> 精选技能{featured.length > 0 ? ` (${featured.length})` : ''}
              </div>
              {featured.length > 0 ? (
                <div className="space-y-1">
                  {featured.map((r, i) => (
                    <HubSkillCard
                      key={i}
                      r={r}
                      installing={installing}
                      installMsg={installMsg}
                      installed={isInstalled(r)}
                      onInstall={(id) => void doInstall(id, r.name || '')}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">
                  <span>用上方搜索浏览可安装技能</span>
                </div>
              )}
            </>
          ) : (
            <>
              {results.length > 0 && (
                <div className="space-y-1">
                  {results.map((r, i) => (
                    <HubSkillCard
                      key={i}
                      r={r}
                      installing={installing}
                      installMsg={installMsg}
                      installed={isInstalled(r)}
                      onInstall={(id) => void doInstall(id, r.name || '')}
                    />
                  ))}
                </div>
              )}

              {!searching && !searchError && results.length === 0 && query && (
                <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">未找到匹配 &ldquo;{query}&rdquo; 的技能</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
