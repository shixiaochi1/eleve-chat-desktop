/**
 * CreateAgentPopover — 新建 Agent 弹出卡片（锚定在侧边栏「新建 Agent」按钮下方）
 *
 * 对齐 Hermes CreateProfileDialog 的表单语义（昵称 + 人物性格 SOUL.md + 克隆来源）：
 *   - 从侧边栏按钮下方弹出（不居中、无全屏遮罩，不遮挡正在运行的聊天区）
 *   - 昵称主输入（支持中文），ID 自动生成（拼音懒加载）——不展示 ID 输入框
 *   - 人物性格文本域（可选，写入 SOUL.md 身份块下方；留空用默认模板）
 *   - 高级选项（默认折叠）：克隆来源（默认克隆 default，空白 = no_skills）
 *   - 创建成功 → 自动切换新 Agent
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createProfile } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { generateProfileId, ensureUniqueId } from '../lib/profile-id';

export const CLONE_BLANK = '__none__';

/** Agent 主题色板（对齐 Hermes PROFILE_COLORS 22 色） */
export const AGENT_PALETTE = [
  '#3498DB', '#1ABC9C', '#2ECC71', '#9B59B6', '#E67E22', '#E74C3C',
  '#16A085', '#2980B9', '#8E44AD', '#27AE60', '#D35400', '#C0392B',
  '#F39C12', '#34495E', '#E84393', '#00B894', '#0984E3', '#6C5CE7',
  '#FD79A8', '#00CEC9', '#FDCB6E', '#636E72',
];

interface CreateAgentPopoverProps {
  onClose: () => void;
  /** 创建成功后刷新列表 */
  onCreated?: (name: string) => void;
  /** 创建成功后切换（App.currentProfile 驱动高亮） */
  onProfileChange?: (name: string) => void;
  profiles: Array<{ name: string; display_name?: string | null }>;
}

export default function CreateAgentPopover({ onClose, onCreated, onProfileChange, profiles }: CreateAgentPopoverProps) {
  const [nickname, setNickname] = useState('');
  const [persona, setPersona] = useState('');
  const [color, setColor] = useState<string>(AGENT_PALETTE[0]);
  const [cloneSource, setCloneSource] = useState<string>('default');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc → 关闭（浮层无遮罩，必须自行管理）
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

  // 昵称变化 → 自动生成 ID（ID 不展示给用户，仅提交时使用）
  const generatedIdRef = useRef('');
  useEffect(() => {
    const raw = nickname.trim();
    if (!raw) { generatedIdRef.current = ''; return; }
    let cancelled = false;
    generateProfileId(raw)
      .then((base) => {
        if (cancelled) return;
        generatedIdRef.current = ensureUniqueId(base, profiles.map((p) => p.name));
      })
      .catch(() => { /* 生成失败不阻塞，创建时兜底 */ })
      .finally(() => { /* noop */ });
    return () => { cancelled = true; };
  }, [nickname, profiles]);

  const nickError = nickname.trim() ? null : '昵称不能为空';
  const canSubmit = !busy && !nickError;

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return;
    const nick = nickname.trim();
    const soul = persona.trim();
    setBusy(true);
    setError(null);
    try {
      // ID 兜底：生成失败时用时间戳后缀（后端会校验，若非法则报错可见）
      let id = generatedIdRef.current;
      if (!id) {
        id = `agent-${Date.now().toString(36)}`;
      }
      const blank = cloneSource === CLONE_BLANK;
      await createProfile(
        id,
        nick,
        blank ? undefined : cloneSource,
        { noSkills: blank, ...(soul ? { soul } : {}), color },
      );
      notifySuccess(`Agent「${nick}」已创建并切换`);
      onProfileChange?.(id);
      onCreated?.(id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      notifyError(err, `创建 ${nick} 失败`);
    } finally {
      setBusy(false);
    }
  }, [canSubmit, nickname, persona, color, cloneSource, onProfileChange, onCreated, onClose]);

  return (
    <div
      ref={rootRef}
      className="absolute top-[calc(100%+6px)] left-2 right-2 z-50 max-h-[calc(100vh-120px)] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg panel-enter"
    >
      {/* ── 头部 ── */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
        <span className="text-xs font-semibold text-foreground">新建 Agent</span>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-40"
          title="关闭"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
      <p className="px-3.5 pb-2 -mt-0.5 text-[11px] text-muted-foreground/60">填昵称和人物性格，ID 自动生成</p>

      <div className="grid gap-3.5 px-3.5 pb-3.5">
          {/* ── 昵称（主输入） ── */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="new-agent-nickname">
              昵称
            </label>
            <input
              id="new-agent-nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleCreate(); }}
              placeholder="小老虎"
              autoFocus
              disabled={busy}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            {nickError && <p className="text-[11px] text-destructive">{nickError}</p>}
          </div>

          {/* ── 主题色（对齐 Hermes profile 色板 22 色） ── */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="new-agent-color">
              主题色
            </label>
            <div id="new-agent-color" className="flex flex-wrap gap-1.5">
              {AGENT_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  disabled={busy}
                  title={c}
                  aria-label={c}
                  className={cn(
                    'w-5 h-5 rounded-full transition-all disabled:opacity-50',
                    color.toLowerCase() === c.toLowerCase()
                      ? 'ring-2 ring-offset-1 ring-offset-popover ring-foreground/70 scale-110'
                      : 'hover:scale-110 opacity-80 hover:opacity-100'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* ── 人物性格（SOUL.md，对齐 Hermes 创建弹窗文本框） ── */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="new-agent-persona">
              人物性格 <span className="font-normal text-muted-foreground/60">- 可选</span>
            </label>
            <textarea
              id="new-agent-persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder={'这个 Agent 的身份与性格描述，例如：\n你是「小老虎」，说话干脆利落，喜欢用表情符号，擅长 Rust 架构设计。'}
              disabled={busy}
              rows={4}
              className="w-full px-2.5 py-1.5 text-xs leading-5 rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 resize-none"
            />
            <p className="text-[11px] text-muted-foreground/60">留空使用默认人设；填写后会写入该 Agent 的 SOUL.md，后续可随时修改</p>
          </div>

          {/* ── 高级选项（默认折叠） ── */}
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors select-none"
          >
            <ChevronDown size={12} strokeWidth={2} className={cn('transition-transform duration-150', showAdvanced && 'rotate-180')} />
            高级选项
          </button>

          {showAdvanced && (
            <div className="grid gap-3.5 pt-0.5 panel-enter">
              {/* 克隆来源（对齐 Hermes：默认克隆 default，空白 = 不克隆） */}
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="new-agent-clone">
                  克隆来源
                </label>
                <select
                  id="new-agent-clone"
                  value={cloneSource}
                  onChange={(e) => setCloneSource(e.target.value)}
                  disabled={busy}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                >
                  <option value={CLONE_BLANK}>空白配置（不克隆）</option>
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>克隆自 {p.display_name || p.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground/60">空白 = 全新配置；克隆会继承该 Agent 的配置与技能</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-1.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-[8px] bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.18)] hover:brightness-[1.06] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : <Plus size={13} strokeWidth={2.5} />}
            创建
          </button>
        </div>
    </div>
  );
}
