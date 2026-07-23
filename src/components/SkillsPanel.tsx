/**
 * SkillsPanel — 技能管理
 * Apple 风格，lucide 图标，适配 260px 面板
 * 
 * v2: 所有 API 调用走 bridge.call()，不再直接 fetch
 */
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { SkillInfo } from '@/types/eleve';
import {
  PackageIcon, SearchIcon, GlobeIcon,
  FolderIcon, DeleteIcon, NewIcon,
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

/** 本地已安装技能列表 */
function LocalSkillsList() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    call('list_skills', {})
      .then((data: SkillItem[]) => setSkills(Array.isArray(data) ? data : []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><FolderIcon size={12} /> 本地技能 — 加载中...</div>;
  if (skills.length === 0) return null;

  return (
    <div className="space-y-1 pt-1 border-t border-border/50">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><FolderIcon size={12} /> 本地技能 ({skills.length})</div>
      <div className="space-y-1">
        {skills.map((s, i) => (
          <div key={i} className="p-2 rounded border border-border bg-muted/10">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-xs text-foreground truncate flex-1">{s.name || '?'}</span>
              {s.category && <span className="px-1 py-0.5 text-[10px] bg-muted/30 text-muted-foreground rounded">{s.category}</span>}
            </div>
            {s.description && <div className="text-[10px] text-muted-foreground/60">{s.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SkillsPanel() {
  const [tab, setTab] = useState('installed');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkillItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installMsg, setInstallMsg] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<SkillItem[]>([]);
  const [instLoading, setInstLoading] = useState(false);
  const [taps, setTaps] = useState<TapItem[]>([]);
  const [tapRepo, setTapRepo] = useState('');
  const [tapMsg, setTapMsg] = useState('');

  useEffect(() => { refreshInstalled(); refreshTaps(); }, []);

  const refreshInstalled = useCallback(async () => {
    setInstLoading(true);
    try {
      const data: SkillItem[] = await call('list_hub_skills', {});
      setInstalled(Array.isArray(data) ? data : []);
    } catch { setInstalled([]); }
    setInstLoading(false);
  }, []);

  const refreshTaps = useCallback(async () => {
    try {
      const data: TapItem[] = await call('list_hub_taps', {});
      setTaps(Array.isArray(data) ? data : []);
    } catch { setTaps([]); }
  }, []);

  const doSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data: SkillItem[] = await call('search_skills_hub', { query, limit: 15 });
      setResults(Array.isArray(data) ? data : []);
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
      } else {
        setInstallMsg((prev) => ({ ...prev, [identifier]: `failed: ${data?.error || 'unknown'}` }));
      }
    } catch (err: unknown) {
      setInstallMsg((prev) => ({ ...prev, [identifier]: `failed: ${(err as Error).message}` }));
    }
    setInstalling((prev) => ({ ...prev, [identifier]: false }));
  }, [refreshInstalled]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') doSearch(); };

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

      {/* Tab: Installed */}
      {tab === 'installed' && (
        <div className="space-y-2">
          {/* Taps */}
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

          {/* Installed list */}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><PackageIcon size={12} /> Hub 已安装 ({installed.length})</div>
          {instLoading ? (
            <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">加载中...</div>
          ) : installed.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">
              <span>暂无 Hub 安装的技能</span>
              <span className="text-[10px] text-muted-foreground/50">切换到 Hub 标签搜索安装</span>
            </div>
          ) : (
            <div className="space-y-1">
              {installed.map((s, i) => (
                <div key={i} className="p-2 rounded border border-border">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-xs text-foreground truncate flex-1">{s.name || '?'}</span>
                    {trustBadge(s.trust_level, s.source)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/50">
                    source: {s.source || '?'}
                    {s.install_path && <span className="ml-1"> | {s.install_path}</span>}
                    {typeof s.install_path === 'object' && (s.install_path as unknown as { get: (k: string) => string })?.get && (
                      <span className="ml-1"> | {(s.install_path as unknown as { get: (k: string) => string })?.get('install_path')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Local skills list */}
          <LocalSkillsList />
        </div>
      )}

      {/* Tab: Hub */}
      {tab === 'hub' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70"><SearchIcon size={12} /> 搜索 Skills Hub</div>
          <div className="flex items-center gap-1">
            <input className="flex-1 px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring" placeholder="搜索技能..."
              value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} onKeyDown={handleKeyDown} />
            <button className="px-2 py-1 text-xs bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors disabled:opacity-50" onClick={doSearch} disabled={searching}>
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>

          {searchError && <div className="text-xs text-destructive">{searchError}</div>}

          {results.length > 0 && (
            <div className="space-y-1">
              {results.map((r, i) => (
                <div key={i} className="p-2 rounded border border-border">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-xs text-foreground truncate flex-1">{r.name}</span>
                    {trustBadge(r.trust_level, r.source)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mb-1">{r.description || '(无描述)'}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/50">{r.source} — {r.identifier}</span>
                    <button
                      className="px-2 py-0.5 text-[10px] bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
                      disabled={installing[r.identifier || ''] || installMsg[r.identifier || ''] === 'ok'}
                      onClick={() => doInstall(r.identifier || '', r.name || '')}>
                      {installing[r.identifier || ''] ? '安装中...' :
                       installMsg[r.identifier || ''] === 'ok' ? '已安装' : '安装'}
                    </button>
                  </div>
                  {installMsg[r.identifier || ''] && installMsg[r.identifier || ''] !== 'ok' && (
                    <div className="text-[10px] text-destructive mt-1">{installMsg[r.identifier || '']}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!searching && !searchError && results.length === 0 && query && (
            <div className="flex flex-col items-center py-4 text-xs text-muted-foreground gap-1">未找到匹配 &ldquo;{query}&rdquo; 的技能</div>
          )}
        </div>
      )}
    </div>
  );
}
