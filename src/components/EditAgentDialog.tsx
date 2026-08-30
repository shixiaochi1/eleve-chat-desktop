/**
 * EditAgentDialog — Agent 编辑面板（双击 Agent 卡片弹出）
 *
 * 对齐 Hermes profile-modal 的分区结构：
 *   - 外观：主题色 22 色板（对齐 Hermes PROFILE_COLORS）
 *   - 昵称：修改 display_name（同步 SOUL.md 身份块，后端 profiles.set_display_name）
 *   - SOUL.md：人物性格/身份编辑器（profiles.get_soul / set_soul）
 *   - MEMORY.md：Agent 长期记忆编辑器（profiles.get_memory / set_memory）
 *   - USER.md：用户对 Agent 的指示/用户档案（profiles.get_user / set_user）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Palette, Save, Sparkles, X, BookOpen, User, Camera, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProfileSoul, getProfileMemory, getProfileUser, setProfileColor, setDisplayName, setProfileSoul, setProfileMemory, setProfileUser, setProfileAvatar, getProfileAvatar, setProfileAvatarKey } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { AGENT_PALETTE } from '../lib/agent-palette';
import { AGENT_AVATARS, AgentAvatarSvg, getAgentAvatarDef } from '../lib/agent-avatars';

type EditTab = 'appearance' | 'soul' | 'memory' | 'user';

interface EditAgentDialogProps {
  profile: { name: string; display_name?: string | null; color?: string | null; avatar_key?: string | null };
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
  // 🔴 2026-08-02 头像卡片：默认头像 key（预设库）+ 上传 dataURL（互斥，后端保证）
  const [avatarKey, setAvatarKey] = useState<string | null>(profile.avatar_key || null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [soul, setSoul] = useState('');
  const [soulOriginal, setSoulOriginal] = useState('');
  const [soulLoading, setSoulLoading] = useState(false);
  const [soulBusy, setSoulBusy] = useState(false);
  const [memory, setMemory] = useState('');
  const [memoryOriginal, setMemoryOriginal] = useState('');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [user, setUser] = useState('');
  const [userOriginal, setUserOriginal] = useState('');
  const [userLoading, setUserLoading] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 🔴 2026-08-02 修复：卡片本体可拖动调整大小（右下角手柄），textarea 不再自带 resize-y
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(420, Math.min(startW + (ev.clientX - startX), window.innerWidth - 48));
      const h = Math.max(320, Math.min(startH + (ev.clientY - startY), window.innerHeight - 64));
      setDims({ w, h });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

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

  // 🔴 2026-08-02 断线修复：懒加载用 ref 标记防重复加载（soulLoading 在依赖数组 → setSoulLoading(true)
  // 触发 effect 重跑 → cleanup 置 cancelled → 请求返回被丢弃 → finally 又触发重跑 → 无限循环，内容永远空白）
  const loadedRef = useRef<Partial<Record<EditTab, boolean>>>({});

  // 按 tab 懒加载
  useEffect(() => {
    if (tab === 'soul' && !loadedRef.current.soul) {
      loadedRef.current.soul = true;
      setSoulLoading(true);
      getProfileSoul(profile.name)
        .then((data) => { setSoul(data.content); setSoulOriginal(data.content); })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSoulLoading(false));
    }
    if (tab === 'memory' && !loadedRef.current.memory) {
      loadedRef.current.memory = true;
      setMemoryLoading(true);
      getProfileMemory(profile.name)
        .then((data) => { setMemory(data.content); setMemoryOriginal(data.content); })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setMemoryLoading(false));
    }
    if (tab === 'user' && !loadedRef.current.user) {
      loadedRef.current.user = true;
      setUserLoading(true);
      getProfileUser(profile.name)
        .then((data) => { setUser(data.content); setUserOriginal(data.content); })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setUserLoading(false));
    }
  }, [tab, profile.name]);

  // 🔴 2026-08-02 头像：挂载时拉取上传图（仅无默认头像 key 时；有 key 用预设 SVG）
  useEffect(() => {
    if (avatarKey) { setAvatar(null); return; }
    let cancelled = false;
    getProfileAvatar(profile.name)
      .then((res) => { if (!cancelled && res?.exists && res.data) setAvatar(res.data); })
      .catch(() => { /* 静默：无头像 */ });
    return () => { cancelled = true; };
  }, [profile.name, avatarKey]);

  const flashSaved = useCallback((msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 1600);
  }, []);

  // 🔴 2026-08-02 选择默认头像：set_avatar_key → 本地即时生效 + 热刷新
  const handlePickAvatarKey = useCallback(async (key: string) => {
    setAvatarPickerOpen(false);
    setAvatarKey(key);
    setAvatar(null);
    setError(null);
    try {
      await setProfileAvatarKey(profile.name, key);
      flashSaved('头像已更新');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存头像失败');
    }
  }, [profile.name, flashSaved, onSaved]);

  // 🔴 2026-08-02 头像上传：读文件 → base64 dataURL → set_avatar → 本地即时预览 + 通知刷新
  const handleAvatarChange = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（PNG/JPEG/WebP/GIF）');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片过大，请选择 5MB 以内的图片');
      return;
    }
    setAvatarBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      // 先本地预览（即时反馈），再上传
      setAvatar(dataUrl);
      setAvatarKey(null);
      await setProfileAvatar(profile.name, dataUrl);
      flashSaved('头像已更新');
      // 🔴 热更新：通知 App 刷新列表（侧栏/宫格头像即时生效）
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '上传头像失败');
    } finally {
      setAvatarBusy(false);
    }
  }, [profile.name, flashSaved, onSaved]);

  const handlePickColor = useCallback(async (c: string) => {
    setColor(c);
    setColorBusy(true);
    setError(null);
    try {
      await setProfileColor(profile.name, c);
      flashSaved('颜色已保存');
      // 🔴 热更新：保存后通知 App 刷新列表（宫格卡片/侧栏色块即时生效，不依赖重启）
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存颜色失败');
    } finally {
      setColorBusy(false);
    }
  }, [profile.name, flashSaved, onSaved]);

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

  const handleSaveUser = useCallback(async () => {
    setUserBusy(true);
    setError(null);
    try {
      await setProfileUser(profile.name, user);
      setUserOriginal(user);
      flashSaved('USER.md 已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, '保存 USER.md 失败');
    } finally {
      setUserBusy(false);
    }
  }, [user, profile.name, flashSaved]);

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
        className="relative flex flex-col rounded-2xl border border-[var(--ui-stroke-tertiary)] bg-popover shadow-2xl panel-enter overflow-hidden"
        style={dims
          ? { width: dims.w, height: dims.h }
          : { width: 'min(560px, calc(100vw - 48px))', maxHeight: 'min(640px, calc(100vh - 64px))' }}
      >
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2 border-b border-[var(--ui-stroke-tertiary)]">
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
          {tabBtn('user', 'USER.md', <User size={12} strokeWidth={2} />)}
          {saved && (
            <span className="ml-auto text-[11px] text-success animate-pulse">{saved}</span>
          )}
        </div>

        {/* ── 内容 ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5">
          {error && (
            <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              {error}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="grid gap-6">
              {/* ═══ 头像卡片（点击 → 选择面板：默认头像库 + 上传）═══ */}
              <div className="grid gap-2">
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setAvatarPickerOpen(true)}
                    disabled={avatarBusy}
                    className="group relative w-20 h-20 shrink-0 rounded-full overflow-hidden ring-2 ring-[var(--ui-stroke-tertiary)] hover:ring-primary/50 transition-all disabled:opacity-60 disabled:cursor-wait"
                    title="点击更换头像"
                  >
                    {avatar ? (
                      <img src={avatar} alt="头像" className="w-full h-full object-cover" />
                    ) : avatarKey ? (
                      <span className="block w-full h-full p-3.5" style={{ color }}>
                        <AgentAvatarSvg avatarKey={avatarKey} color={color} />
                      </span>
                    ) : (
                      <span
                        className="flex items-center justify-center w-full h-full text-2xl font-semibold uppercase"
                        style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
                      >
                        {(profile.display_name || profile.name).replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}
                      </span>
                    )}
                    {/* hover 遮罩：相机图标 + 提示 */}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                      {avatarBusy ? (
                        <Loader size={18} className="animate-spin text-white" />
                      ) : (
                        <Camera size={18} className="text-white" />
                      )}
                    </span>
                  </button>
                  <div className="min-w-0 grid gap-1">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {profile.display_name || profile.name}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground/60 truncate">{profile.name}</span>
                    <span className="text-[11px] text-muted-foreground/60">点击头像选择预设形象或上传自定义图片</span>
                  </div>
                </div>

                {/* ── 头像选择面板（点击头像弹出）── */}
                {avatarPickerOpen && (
                  <div className="rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card p-3 grid gap-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground">选择头像（随主题色变化）</span>
                    <div className="grid grid-cols-6 gap-2">
                      {AGENT_AVATARS.map((a) => {
                        const selected = avatarKey === a.key;
                        return (
                          <button
                            key={a.key}
                            type="button"
                            onClick={() => void handlePickAvatarKey(a.key)}
                            title={a.label}
                            className={cn(
                              'flex flex-col items-center gap-1 rounded-lg p-1.5 transition-all',
                              selected
                                ? 'bg-primary/15 ring-1 ring-primary/50'
                                : 'hover:bg-accent/40'
                            )}
                          >
                            <span className="w-9 h-9" style={{ color }}>
                              <AgentAvatarSvg avatarKey={a.key} color={color} />
                            </span>
                            <span className="text-[9px] text-muted-foreground/70">{a.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between border-t border-[var(--ui-stroke-tertiary)] pt-2">
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                      >
                        <Camera size={12} strokeWidth={2} />
                        上传自定义图片
                      </button>
                      <button
                        type="button"
                        onClick={() => setAvatarPickerOpen(false)}
                        className="px-2.5 py-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    void handleAvatarChange(e.target.files?.[0]);
                    e.target.value = ''; // 允许重复选同一文件
                  }}
                />
              </div>

              {/* ═══ 昵称 ═══ */}
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
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-[var(--ui-stroke-tertiary)] bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
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

              {/* ═══ 主题色 ═══ */}
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
                        'w-7 h-7 rounded-full transition-all disabled:opacity-50',
                        color.toLowerCase() === c.toLowerCase()
                          ? 'ring-2 ring-offset-2 ring-offset-popover ring-foreground/70 scale-110'
                          : 'hover:scale-110 opacity-80 hover:opacity-100'
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60">主题色用于侧栏/宫格卡片标识，选色即时保存</p>
              </div>
            </div>
          )}

          {tab === 'soul' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">人物性格 / 身份（SOUL.md）</label>
                {soul !== soulOriginal && soulOriginal !== '' && (
                  <span className="text-[11px] text-warning">未保存</span>
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
                  className="w-full px-2.5 py-2 text-xs leading-5 font-mono rounded-md border border-[var(--ui-stroke-tertiary)] bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
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
                  <span className="text-[11px] text-warning">未保存</span>
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
                  className="w-full px-2.5 py-2 text-xs leading-5 font-mono rounded-md border border-[var(--ui-stroke-tertiary)] bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
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

          {tab === 'user' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">用户档案 / 对 Agent 的指示（USER.md）</label>
                {user !== userOriginal && userOriginal !== '' && (
                  <span className="text-[11px] text-warning">未保存</span>
                )}
              </div>
              {userLoading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground/50">
                  <Loader size={16} strokeWidth={2} className="animate-spin" />
                </div>
              ) : (
                <textarea
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  disabled={userBusy}
                  rows={14}
                  placeholder="空 — 无用户档案"
                  className="w-full px-2.5 py-2 text-xs leading-5 font-mono rounded-md border border-[var(--ui-stroke-tertiary)] bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                />
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSaveUser()}
                  disabled={userBusy || userLoading || user === userOriginal}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  {userBusy ? <Loader size={12} strokeWidth={2.5} className="animate-spin" /> : <Save size={12} strokeWidth={2.5} />}
                  保存 USER.md
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 🔴 2026-08-02：右下角拖拽手柄 — 拖动卡片本身调整大小（textarea 已去 resize-y） */}
        <div
          onMouseDown={startResize}
          className="absolute bottom-0.5 right-0.5 w-5 h-5 flex items-center justify-center cursor-nwse-resize text-muted-foreground/40 hover:text-foreground/70 transition-colors select-none"
          title="拖动调整卡片大小"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M9 9 L9 6 M9 9 L6 9 M9 9 L4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
