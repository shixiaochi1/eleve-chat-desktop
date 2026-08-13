/**
 * ProjectDialogs — 项目对话框（新建/编辑/外观）+ 会话重命名对话框
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 ProjectTreePanel.tsx 纯移动抽取（diff 无逻辑变更）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Home, RefreshCw, FolderGit } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { projectIconFor, PROJECT_ICON_KEYS } from '../lib/project-icons';
import { AGENT_PALETTE } from '../lib/agent-palette';
import { randomIdeaTemplates, type ProjectIdeaTemplate } from '../lib/project-idea-templates';
import { generateProjectIdea } from '../lib/llm-oneshot';
import { renameSessionAction } from '../lib/session-actions';
import { pickDirectory } from '../utils/directory-picker';
import { notifySuccess, notifyError } from '../utils/notifications';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import { writeProjectIdea, type SessionPreview, type ProjectNode } from './ProjectTreeItems';

export function ProjectDialog({ open, initial, onClose, onSaved, profile }: {
  open: boolean;
  initial: ProjectNode | null; // null = 新建
  onClose: () => void;
  onSaved: () => void;
  /** 显式 profile：防多 Profile 串台 */
  profile?: string;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(AGENT_PALETTE[0]);
  const [icon, setIcon] = useState<string | null>(null);
  // 新建模式：多文件夹（对齐 Hermes project-dialog：folders 列表 + primary badge + 移除）；
  // 编辑模式：单主文件夹（folder，走 set_primary 更换）
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  // 项目 idea（对齐 Hermes project-dialog：textarea + 模板 chips + shuffle + AI 生成；
  // 仅新建模式；保存后 best-effort 写 IDEA.md 到主文件夹）
  const [idea, setIdea] = useState('');
  const [templates, setTemplates] = useState<ProjectIdeaTemplate[]>([]);
  const [generatingIdea, setGeneratingIdea] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (open) {
      setName(initial?.label ?? '');
      setColor(initial?.color || AGENT_PALETTE[0]);
      setIcon(initial?.icon ?? null);
      setFolders(initial?.path ? [initial.path] : []);
      setFolder(initial?.path ?? '');
      setIdea('');
      setTemplates(randomIdeaTemplates());
      setGeneratingIdea(false);
      setConfirmArchive(false);
    }
  }, [open, initial]);

  const pickFolder = useCallback(async () => {
    if (!desktop) { notifyError(null, '原生对话框仅桌面端可用'); return; }
    const path = await pickDirectory(initial ? '选择主文件夹' : '选择项目文件夹（可选）', initial?.path || undefined);
    if (!path) return;
    if (initial) {
      // 编辑模式：立即设为主文件夹（projects.set_primary）
      try {
        await call('projects_set_primary', { id: initial.id, path, profile });
        setFolder(path);
        setFolders([path]);
        notifySuccess('主文件夹已更新');
        onSaved();
      } catch (e) { notifyError(e, '更新文件夹失败'); }
    } else {
      // 新建模式：追加到多文件夹列表（去重；首个 = primary）
      setFolders(prev => {
        if (prev.includes(path)) return prev;
        // 🔴 2026-08-13 老大指示：项目名称自动取所选文件夹名（首个文件夹定名，后续不改）
        if (prev.length === 0) {
          const base = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
          if (base) setName(base);
        }
        return [...prev, path];
      });
    }
  }, [desktop, initial, onSaved, profile]);

  const save = useCallback(async () => {
    // 🔴 2026-08-13 老大指示：新建项目必须先选文件夹（名称自动取文件夹名，无手写名称栏）
    if (!initial && folders.length === 0) {
      notifyError(null, '请先选择项目文件夹');
      return;
    }
    if (initial && !name.trim()) { notifyError(null, '请输入项目名称'); return; }
    const finalName = initial ? name.trim() : (name.trim() || (folders[0] ? folders[0].replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '' : ''));
    setSaving(true);
    try {
      let savedFolder: string | undefined;
      if (initial && !initial.isAuto) {
        await call('projects_update', { id: initial.id, name: finalName, color, ...(icon ? { icon } : { icon: '' }), profile });
        notifySuccess('项目已更新');
      } else if (initial) {
        // 🔴 自动项目编辑 = 收养（对齐 Hermes setProjectAppearance adopt）：
        // 无 projects.db 记录 → create 带外观 + 主文件夹（repo root）
        await call('projects_create', {
          name: finalName,
          color,
          ...(icon ? { icon } : {}),
          ...(folder ? { folders: [folder], primary_path: folder } : {}),
          profile,
        });
        savedFolder = folder || undefined;
        notifySuccess('已设为显式项目');
      } else {
        await call('projects_create', {
          name: finalName,
          color,
          ...(icon ? { icon } : {}),
          ...(folders.length > 0 ? { folders, primary_path: folders[0] } : {}),
          profile,
        });
        savedFolder = folders[0];
        notifySuccess('项目已创建');
      }
      // 对齐 Hermes writeProjectIdea：best-effort 写 IDEA.md 到主文件夹（项目创建不受影响）
      if (idea.trim() && savedFolder && isTauri()) {
        void writeProjectIdea(savedFolder, idea);
      }
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, '保存失败');
    } finally {
      setSaving(false);
    }
  }, [name, color, icon, folders, folder, idea, initial, onSaved, onClose, profile]);

  // 归档两步确认（防误触）
  const archive = useCallback(async () => {
    if (!initial) return;
    if (!confirmArchive) { setConfirmArchive(true); return; }
    setSaving(true);
    try {
      await call('projects_archive', { id: initial.id, profile });
      notifySuccess('项目已归档');
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, '归档失败');
    } finally {
      setSaving(false);
    }
  }, [initial, confirmArchive, onSaved, onClose, profile]);

  // AI 生成 idea（对齐 Hermes generateProjectIdea → llm.oneshot；失败静默保持现状）
  const generateIdea = useCallback(async () => {
    if (generatingIdea) return;
    setGeneratingIdea(true);
    try {
      const text = await generateProjectIdea(name, profile);
      if (text) setIdea(text);
    } finally {
      setGeneratingIdea(false);
    }
  }, [name, profile, generatingIdea]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? (initial.isAuto ? '设为显式项目' : (initial.isNoProject ? '编辑工作区（Home）' : '编辑项目')) : '新建项目'}</DialogTitle>
          <DialogDescription>
            {initial?.isAuto
              ? '自动项目由磁盘扫描派生，保存后将收养成显式项目（名称/颜色/图标可自定义）'
              : initial?.isNoProject
                ? 'Home 是当前 Agent 的 workspace 收纳桶（杂项会话兜底），可自定义名称/颜色/图标与主文件夹'
                : '会话的工作目录落在项目文件夹下即自动归入本项目（按 Repo/分支分组）'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {/* ① 实时预览（紧凑单行） */}
          <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <div
              className="grid size-8 shrink-0 place-items-center rounded-lg shadow-sm transition-colors"
              style={{
                background: color || 'var(--dt-primary)',
                color: (() => {
                  const bg = color || '#007AFF';
                  const c = bg.replace('#', '');
                  const r = parseInt(c.slice(0, 2), 16) / 255;
                  const g = parseInt(c.slice(2, 4), 16) / 255;
                  const b = parseInt(c.slice(4, 6), 16) / 255;
                  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#1D1D1F' : '#FFFFFF';
                })(),
              }}
            >
              {icon ? (() => { const Ic = projectIconFor(icon); return <Ic size={15} />; })() : <FolderGit size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{name.trim() || '未命名项目'}</div>
              <div className="text-[10px] text-muted-foreground">
                {initial ? (initial.isAuto ? '设为显式项目后可自定义外观' : '编辑项目外观与文件夹') : '新项目将以此外观创建'}
              </div>
            </div>
          </div>

          {/* ② 项目名称：新建 = 自动取所选文件夹名（老大 2026-08-13，无手写栏）；编辑 = 可手写 */}
          {initial ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">项目名称</label>
              <input
                className="desktop-input-chrome h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none transition-shadow focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：Eleve Agent"
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">项目名称（自动取所选文件夹名）</label>
              <div className="h-8 w-full rounded-lg border border-border bg-muted/30 px-2.5 text-sm leading-8 text-foreground/70 truncate">
                {name.trim() || '未选择文件夹'}
              </div>
            </div>
          )}

          {/* ③ 外观：主题色 + 图标（flex 固定尺寸，间距恒定不随容器放大） */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">主题色</label>
              <div className="flex flex-wrap gap-1">
                {AGENT_PALETTE.map((c) => (
                  <button
                    key={c}
                    className={cn(
                      'size-4 rounded-full transition-transform hover:scale-110',
                      color === c ? 'ring-1.5 ring-foreground ring-offset-1 ring-offset-background scale-110' : ''
                    )}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">图标</label>
              <div className="flex flex-wrap gap-1">
                {PROJECT_ICON_KEYS.map((key) => {
                  const Icon = projectIconFor(key);
                  const active = icon === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-md border transition-all',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                      style={active && color ? { color } : undefined}
                      onClick={() => setIcon(active ? null : key)}
                      title={key}
                    >
                      <Icon size={13} />
                    </button>
                  );
                })}
              </div>
              {icon && <button className="mt-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setIcon(null)}>清除图标</button>}
            </div>
          </div>

          {/* 文件夹（对齐 Hermes project-dialog：新建多文件夹列表 + primary badge + 移除） */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {initial ? '主文件夹' : '项目文件夹'}
            </label>
            {initial ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                  title={folder || undefined}
                >
                  {folder || '未选择 — 可稍后从项目菜单添加'}
                </span>
                <button
                  className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  更换
                </button>
              </div>
            ) : folders.length === 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  未选择文件夹 — 可稍后从项目菜单添加
                </span>
                <button
                  className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  选择
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {folders.map((f, i) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span
                      className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                      title={f}
                    >
                      {f}
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] text-primary">主</span>
                    )}
                    <button
                      className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => setFolders(prev => prev.filter(x => x !== f))}
                      title="移除文件夹"
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button
                  className="self-start rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  + 添加文件夹
                </button>
              </div>
            )}
          </div>

          {/* 项目 Idea（对齐 Hermes project-dialog：textarea + AI 生成 + 模板 chips + shuffle；仅新建） */}
          {!initial && (
            <div className="flex flex-col gap-1.5">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">项目 Idea（可选）</label>
              <div className="relative">
                <textarea
                  className="min-h-24 w-full rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs outline-none resize-y"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="一句话总结 + 3-5 个目标；创建后写入主文件夹 IDEA.md"
                  disabled={saving}
                />
                <button
                  className="absolute top-1 right-1 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => void generateIdea()}
                  disabled={saving || generatingIdea}
                  title="AI 生成项目 idea"
                >
                  {generatingIdea ? '生成中…' : '✨ 生成'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {templates.map((t) => (
                  <button
                    key={t.label}
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
                    onClick={() => setIdea(t.idea)}
                    disabled={saving}
                    title={t.label}
                  >
                    <span aria-hidden>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
                <button
                  className="rounded-full p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
                  onClick={() => setTemplates(randomIdeaTemplates())}
                  disabled={saving}
                  title="换一批模板"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            </div>
          )}

          {/* 归档危险区（仅显式项目编辑模式；自动项目无记录不可归档；Home 系统桶不归档——老大 2026-08-12：Home 除删除外与项目同权，归档/删除均不提供） */}
          {initial && !initial.isAuto && !initial.isNoProject && (
            <div className="border-t border-border pt-2">
              <button
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs transition-colors',
                  confirmArchive
                    ? 'bg-destructive text-destructive-foreground'
                    : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                )}
                onClick={archive}
                disabled={saving}
              >
                {confirmArchive ? '确认归档？' : '归档项目'}
              </button>
            </div>
          )}
        </div>

        <DialogFooter className="mt-1 gap-2">
          <button
            className="h-8 rounded-lg border border-border px-4 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="flex h-8 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 会话重命名对话框（对齐 Hermes RenameSessionDialog）──
export function SessionRenameDialog({ session, onClose, onRenamed }: {
  session: SessionPreview;
  onClose: () => void;
  onRenamed: (id: string, title: string) => void;
}) {
  const [value, setValue] = useState(session.title || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await renameSessionAction(session.id, next, onRenamed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          className="desktop-input-chrome h-8 w-full rounded-md border px-2.5 text-sm outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            else if (e.key === 'Escape') onClose();
          }}
          placeholder="会话标题"
        />
        <DialogFooter>
          <button
            className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent transition-colors"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="h-8 rounded-md bg-foreground px-3 text-xs text-background hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={() => void submit()}
            disabled={saving || !value.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Panel ──