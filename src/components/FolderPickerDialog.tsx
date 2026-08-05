/**
 * FolderPickerDialog — 目录选择器（浏览器模式专用，对齐 Hermes RemoteFolderPicker）
 *
 * Hermes 桌面 local 模式用系统原生目录选择器；remote/浏览器模式没有原生
 * dialog，自绘一个面包屑 + 目录列表的选择器（readDesktopDir 走后端）。
 * ELEVE 同构：isDesktop() 用 tauri-plugin-dialog 原生选择器；浏览器模式
 * （webchat 调试/降级通道）走本组件，目录列表走后端 WS files.list。
 */
import { useEffect, useMemo, useState } from 'react';
import { Folder, ArrowUp, Loader, FolderInput } from 'lucide-react';
import { call } from '@/utils/bridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** 根前缀：Windows 盘符根 C:\ / POSIX / */
function pathRoot(p: string): string {
  if (/^[A-Za-z]:[\\/]/.test(p)) return p.slice(0, 2) + '\\';
  return '/';
}

/** 父目录（已是根返回 null；C: → C:\ 保持可再进根） */
function parentDir(p: string): string | null {
  const norm = p.replace(/[\\/]+$/, '');
  if (!norm) return null;
  if (/^[A-Za-z]:$/.test(norm)) return norm + '\\';
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (idx <= 0) return null;
  const parent = norm.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** 末尾目录名（C:\Users\Admin → Admin；C:\ → C:\；/ → /） */
function leafName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** 面包屑：根 → 每级可点跳转（对齐 Hermes RemoteFolderPicker crumbs） */
function buildCrumbs(p: string): Array<{ label: string; path: string }> {
  const root = pathRoot(p);
  const out = [{ label: root, path: root }];
  const sep = root === '/' ? '/' : '\\';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  let acc = root;
  for (const part of parts) {
    acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
    out.push({ label: part, path: acc });
  }
  return out;
}

interface FolderPickerDialogProps {
  open: boolean;
  /** 初始路径（会话 cwd / 当前树根） */
  initialPath: string | null;
  title?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export default function FolderPickerDialog({
  open,
  initialPath,
  title = '选择工作目录',
  onClose,
  onSelect,
}: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时定位到 initialPath（无则根）
  useEffect(() => {
    if (open) setCurrentPath(initialPath || pathRoot(initialPath || '/'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 列目录（仅目录项；files.list 走后端 WS，唯一数据源）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    call('files_list', { path: currentPath })
      .then((data) => {
        if (cancelled) return;
        const files = (data as { files?: unknown[] }).files ?? [];
        setEntries(
          (files as DirEntry[]).filter((e) => e && e.isDirectory && !!e.name).sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentPath]);

  const crumbs = useMemo(() => buildCrumbs(currentPath), [currentPath]);
  const parent = parentDir(currentPath);

  const close = (pick?: string) => {
    if (pick) onSelect(pick);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[min(30rem,calc(100vh-4rem))] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-muted-foreground/60">选择文件树根目录（仅目录可选）</DialogDescription>
        </DialogHeader>

        {/* 面包屑 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          {crumbs.map((crumb, i) => (
            <button
              key={crumb.path}
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground ${i === crumbs.length - 1 ? 'text-foreground' : ''}`}
              onClick={() => setCurrentPath(crumb.path)}
            >
              {crumb.label}
            </button>
          ))}
        </div>

        {/* 目录列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {parent && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setCurrentPath(parent)}
            >
              <ArrowUp size={13} />
              <span>..</span>
            </button>
          )}
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader size={12} className="animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <div className="px-2 py-3 text-xs text-destructive">无法读取：{error}</div>
          ) : entries.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground/60">没有子目录</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setCurrentPath(entry.path)}
                title={entry.path}
              >
                <Folder size={13} className="text-warning shrink-0" />
                <span className="min-w-0 truncate">{leafName(entry.path)}</span>
              </button>
            ))
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">{currentPath}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => close()}
            >
              取消
            </button>
            <button
              type="button"
              className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => close(currentPath)}
            >
              <FolderInput size={12} />
              选择此目录
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
