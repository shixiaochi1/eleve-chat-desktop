/**
 * EditAgentDialog — Agent 编辑面板（双击 Agent 卡片弹出）
 *
 * 对齐 Hermes profile-modal 的分区结构：
 *   - 外观：主题色 22 色板（对齐 Hermes PROFILE_COLORS）
 *   - 昵称：修改 display_name（同步 SOUL.md 身份块，后端 profiles.set_display_name）
 *   - SOUL.md：人物性格/身份编辑器（profiles.get_soul / set_soul）
 *   - MEMORY.md：Agent 长期记忆编辑器（profiles.get_memory / set_memory）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Palette, Save, Sparkles, X, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProfileSoul, getProfileMemory, setProfileColor, setDisplayName, setProfileSoul, setProfileMemory } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { AGENT_PALETTE } from '../lib/agent-palette';

type EditTab = 'appearance' | 'soul' | 'memory';

interface EditAgentDialogProps {
  profile: { name: string; display_name?: string | null; color?: string | null };
  onClose: () => void;
  /** 编辑完成后回调（App 刷新 displayNames / 列表）；昵称保存时携带新昵称 */
  onSaved?: (nickname?: string) => void;
}

export default function EditAgentDialog({ profile, onClose, onSaved }: EditAgentDialogProps) {
  const [tab, setTab] = useState<EditTab>('appearance');
  const [color, setColor] = useState<string>(profile.color || AGENT_PALETTE[0]);
  const [colorBusy, setColorBusy] = useState(false);
  const [nickname, setNickname] = useState(profile.display_name || '');
  const [nickBusy, setNickBusy] = useState(false);
  const [soul, setSoul] = useState('');
  const [soulOriginal, setSoulOriginal] = useState('');
  const [soulLoading, setSoulLoading] = useState(false);
  const [soulBusy, setSoulBusy] = useState(false);
  const [memory, setMemory] = useState('');
  const [memoryOriginal, setMemoryOriginal] = useState('');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc → 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 按 tab 懒加载
  useEffect(() => {
    let cancelled = false;
    if (tab === 'soul' && !soulLoading && soulOriginal === '') {
      setSoulLoading(true);
      getProfileSoul(profile.name)
        .then((data) => { if (!cancelled) { setSoul(data.content); setSoulOriginal(data.content); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
        .finally(() => { if (!cancelled) setSoulLoading(false); });
    }
    if (tab === 'memory' && !memoryLoading && memoryOriginal === '') {
      setMemoryLoading(true);
      getProfileMemory(profile.name)
        .then((data) => { if (!cancelled) { setMemory(data.content); setMemoryOriginal(data.content); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
        .finally(() => { if (!cancelled) setMemoryLoading(false); });
    }
    return () => { cancelled = true; };
  }, [tab, profile.name, soulLoading, soulOriginal, memoryLoading, memoryOriginal]);

  const flashSaved = useCallback((msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 1600);
  }, []);

  const handlePickColor = useCallback(async (c: string) => {
    setColor(c);
    setColorBusy(true);
    setError(null);
    try {
      await setProfileColor(profile.name, c);
      flashSaved('颜色已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存颜色失败');
    } finally {
      setColorBusy(false);
    }
  }, [profile.name, flashSaved]);

  const handleSaveNickname = useCallback(async () => {
    const nick = nickname.trim();
    if (!nick) { setError('昵称不能为空'); return; }
    setNickBusy(true);
    setError(null);
    try {
      const res = await setDisplayName(profile.name, nick);
      if (res?.warning) setError(String(res.warning));
      flashSaved('昵称已保存');
      onSaved?.(nick);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存昵称失败');
    } finally {
      setNickBusy(false);
    }
  }, [nickname, profile.name, flashSaved, onSaved]);

  const handleSaveSoul = useCallback(async () => {
    setSoulBusy(true);
    setError(null);
    try {
      await setProfileSoul(profile.name, soul);
      setSoulOriginal(soul);
      flashSaved('SOUL.md 已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存 SOUL.md 失败');
    } finally {
      setSoulBusy(false);
    }
  }, [soul, profile.name, flashSaved]);

  const handleSaveMemory = useCallback(async () => {
    setMemoryBusy(true);
    setError(null);
    try {
      await setProfileMemory(profile.name, memory);
      setMemoryOriginal(memory);
      flashSaved('MEMORY.md 已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存 MEMORY.md 失败');
    } finally {
      setMemoryBusy(false);
    }
  }, [memory, profile.name, flashSaved]);

  const tabBtn = (id: EditTab, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => { setTab(id); setError(null); }}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
        tab === id
          ? 'bg-primary/15 text-primary font-semibold'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onMouseDown={onClose} />

      <div
        ref={rootRef}
        className="relative w-[min(560px,calc(100vw-48px))] max-h-[min(640px,calc(100vh-64px))] flex flex-col rounded-2xl border border-border bg-popover shadow-2xl panel-enter"
      >
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2 border-b border-border/60">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-foreground">编辑 Agent</span>
            <span className="ml-2 text-[11px] font-mono text-muted-foreground/60">{profile.name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/40 transition-colors"
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* ── Tab 切换 ── */}
        <div className="flex items-center gap-1 px-3 pt-2.5">
          {tabBtn('appearance', '外观', <Palette size={12} strokeWidth={2} />)}
          {tabBtn('soul', 'SOUL.md', <Sparkles size={12} strokeWidth={2} />)}
          {tabBtn('memory', 'MEMORY.md', <BookOpen size={12} strokeWidth={2} />)}
          {saved && (
            <span className="ml-auto text-[11px] text-emerald-500 animate-pulse">{saved}</span>
          )}
        </div>

        {/* ── 内容 ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5">
          {error && (
            <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
              {error}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="grid gap-5">
              {/* 主题色 */}
              <div className="grid gap-2">
                <label className="text-xs font-medium text-foreground">主题色</label>
                <div className="flex flex-wrap gap-2">
                  {AGENT_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void handlePickColor(c)}
                      disabled={colorBusy}
                      title={c}
                      aria-label={c}
                      className={cn(
                        'w-6 h-6 rounded-full transition-all disabled:opacity-50',
                        color.toLowerCase() === c.toLowerCase()
                          ? 'ring-2 ring-offset-2 ring-offset-popover ring-foreground/70 scale-110'
                          : 'hover:scale-110 opacity-80 hover:opacity-100'
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60">双击卡片打开本面板，选色即时保存</p>
              </div>

              {/* 昵称 */}
              <div className="grid gap-2">
                <label className="text-xs font-medium text-foreground" htmlFor="edit-agent-nickname">
                  昵称
                </label>
                <div className="flex gap-2">
                  <input
                    id="edit-agent-nickname"
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !nickBusy) void handleSaveNickname(); }}
                    disabled={nickBusy}
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveNickname()}
                    disabled={nickBusy || !nickname.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40"
                  >
                    {nickBusy ? <Loader size={12} strokeWidth={2.5} className="animate-spin" /> : <Save size={12} strokeWidth={2.5} />}
                    保存昵称
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/60">修改后同步更新 SOUL.md 身份块（Agent 自我介绍会知道新名字）</p>
              </div>
            </div>
          )}

          {tab === 'soul' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">人物性格 / 身份（SOUL.md）</label>
                {soul !== soulOriginal && soulOriginal !== '' && (
                  <span className="text-[11px] text-amber-500">未保存</span>
                )}
              </div>
              {soulLoading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground/50">
                  <Loader size={16} strokeWidth={2} className="animate-spin" />
                </div>
              ) : (
                <textarea
                  value={soul}
                  onChange={(e) => setSoul(e.target.value)}
                  disabled={soulBusy}
                  rows={14}
                  placeholder="空 — 使用默认人设"
                  className="w-full px-2.5 py-2 text-xs leading-5 font-mono rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 resize-y"
                />
              )}
              <div className="flex items-center justify-end gap-2">
                <span className="text-[11px] text-muted-foreground/60">注意：{'{<!-- IDENTITY-BEGIN -->}'} 锚点块由昵称系统维护</span>
                <button
                  type="button"
                  onClick={() => void handleSaveSoul()}
                  disabled={soulBusy || soulLoading || soul === soulOriginal}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  {soulBusy ? <Loader size={12} strokeWidth={2.5} className="animate-spin" /> : <Save size={12} strokeWidth={2.5} />}
                  保存 SOUL.md
                </button>
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">长期记忆（MEMORY.md）</label>
                {memory !== memoryOriginal && memoryOriginal !== '' && (
                  <span className="text-[11px] text-amber-500">未保存</span>
                )}
              </div>
              {memoryLoading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground/50">
                  <Loader size={16} strokeWidth={2} className="animate-spin" />
                </div>
              ) : (
                <textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  disabled={memoryBusy}
                  rows={14}
                  placeholder="空 — 无长期记忆"
                  className="w-full px-2.5 py-2 text-xs leading-5 font-mono rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 resize-y"
                />
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSaveMemory()}
                  disabled={memoryBusy || memoryLoading || memory === memoryOriginal}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  {memoryBusy ? <Loader size={12} strokeWidth={2.5} className="animate-spin" /> : <Save size={12} strokeWidth={2.5} />}
                  保存 MEMORY.md
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
