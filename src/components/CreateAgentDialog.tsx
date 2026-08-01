/**
 * CreateAgentPopover — 新建 Agent 弹出卡片（锚定在侧边栏「新建 Agent」按钮下方）
 *
 * 对齐 Hermes CreateProfileDialog 的表单语义，但弹层方式不同：
 *   - 从侧边栏按钮下方弹出（不居中、无全屏遮罩，不遮挡正在运行的聊天区）
 *   - 昵称主输入（支持中文），ID 自动生成（拼音懒加载，可读可改）
 *   - 高级选项（默认折叠）：ID 手动改 + 克隆来源（默认克隆 default，空白 = no_skills）
 *   - 创建成功 → 自动切换新 Agent
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createProfile } from '../utils/api';
import { notifySuccess, notifyError } from '../utils/notifications';
import { generateProfileId, ensureUniqueId, validateProfileId } from '../lib/profile-id';

export const CLONE_BLANK = '__none__';

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
  const [idInput, setIdInput] = useState('');
  const [idTouched, setIdTouched] = useState(false); // 用户手动改过 ID 后不再自动覆盖
  const [idGenerating, setIdGenerating] = useState(false);
  const [cloneSource, setCloneSource] = useState<string>('default');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genSeqRef = useRef(0); // 拼音懒加载竞态：只采纳最后一次生成结果
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

  // 昵称变化 → 自动生成 ID（未手动编辑过时）
  useEffect(() => {
    if (idTouched) return;
    const raw = nickname.trim();
    if (!raw) { setIdInput(''); return; }
    let cancelled = false;
    const seq = ++genSeqRef.current;
    setIdGenerating(true);
    generateProfileId(raw)
      .then((base) => {
        if (cancelled || seq !== genSeqRef.current) return;
        setIdInput(ensureUniqueId(base, profiles.map((p) => p.name)));
      })
      .catch(() => { /* 生成失败不阻塞，用户可手动填 */ })
      .finally(() => { if (!cancelled && seq === genSeqRef.current) setIdGenerating(false); });
    return () => { cancelled = true; };
  }, [open, nickname, idTouched, profiles]);

  // 昵称重置时允许重新自动生成
  const handleNicknameChange = useCallback((v: string) => {
    setNickname(v);
    setIdTouched(false);
  }, []);

  const handleIdChange = useCallback((v: string) => {
    setIdTouched(true);
    setIdInput(v);
  }, []);

  // ID 校验（实时）：合法 + 唯一
  const existingNames = new Set(profiles.map((p) => p.name.toLowerCase()));
  const idError = idInput.trim() ? validateProfileId(idInput) : null;
  const idTaken = !idError && idInput.trim() && existingNames.has(idInput.trim().toLowerCase());
  const nickError = nickname.trim() ? null : '昵称不能为空';
  const canSubmit = !busy && !nickError && !idError && !idTaken && !!idInput.trim();

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return;
    const id = idInput.trim();
    const nick = nickname.trim();
    setBusy(true);
    setError(null);
    try {
      const blank = cloneSource === CLONE_BLANK;
      await createProfile(
        id,
        nick,
        blank ? undefined : cloneSource,
        { noSkills: blank },
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
  }, [canSubmit, idInput, nickname, cloneSource, onProfileChange, onCreated, onClose]);

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
      <p className="px-3.5 pb-2 -mt-0.5 text-[11px] text-muted-foreground/60">只填昵称即可，ID 会自动生成</p>

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
              onChange={(e) => handleNicknameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleCreate(); }}
              placeholder="小老虎"
              autoFocus
              disabled={busy}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            {nickError && <p className="text-[11px] text-destructive">{nickError}</p>}
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
              {/* ID（自动生成，可改） */}
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="new-agent-id">
                  Agent ID
                  {idGenerating && <Loader size={11} strokeWidth={2} className="inline ml-1.5 animate-spin text-muted-foreground/50 align-[-1px]" />}
                </label>
                <input
                  id="new-agent-id"
                  type="text"
                  value={idInput}
                  onChange={(e) => handleIdChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleCreate(); }}
                  placeholder={idGenerating ? '生成中…' : '自动生成'}
                  disabled={busy || idGenerating}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                />
                <p className={cn('text-[11px]', idError ? 'text-destructive' : idTaken ? 'text-destructive' : 'text-muted-foreground/60')}>
                  {idError ?? (idTaken ? `「${idInput.trim()}」已存在，换个 ID` : '小写字母/数字/连字符，中文昵称自动转拼音')}
                </p>
              </div>

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
