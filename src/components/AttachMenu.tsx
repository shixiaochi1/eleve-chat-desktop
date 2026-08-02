import { useState, useRef, useCallback } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { NewIcon, ImageIcon, FileIcon, FolderIcon, GlobeIcon } from './Icons';

interface AttachMenuProps {
  /** 选择图片 — 已接通后端（image.attach_bytes 真实落盘） */
  onPickImage?: () => void;
  /** 添加链接 — 纯前端，URL 插入输入框（立即可用） */
  onAddUrl?: (url: string) => void;
  /** 选择文件/文件夹 — Tauri 原生对话框（对齐 Hermes composer selectDesktopPaths），路径插入输入框 */
  onAddPaths?: (paths: string[]) => void;
}

/**
 * 附件 "+" 菜单 — Hermes 式附件入口（对齐 Hermes composer ContextMenu）
 *
 * 替换原单一 📎 按钮，统一为 Hermes 的 "+" 心智模型。
 * 能力边界：
 * - 「选择图片」接通后端（image.attach_bytes 真实落盘）
 * - 「添加链接」纯前端（URL 插入输入框，随消息发送）
 * - 「选择文件 / 文件夹」接通 Tauri 原生对话框（tauri-plugin-dialog，对齐 Hermes
 *   selectDesktopPaths）；浏览器开发模式（非 Tauri）禁用并标注“仅桌面端”
 *
 * 微交互：菜单展开时 "+" 旋转 45° 呈关闭态。
 */
export default function AttachMenu({ onPickImage, onAddUrl, onAddPaths }: AttachMenuProps) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const desktop = isTauri();

  // 原生文件/文件夹选择（对齐 Hermes selectDesktopPaths）— 动态 import 避免浏览器模式加载插件
  const pickPaths = useCallback(async (directory: boolean) => {
    if (!desktop) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open(
        directory
          ? { directory: true, multiple: false, title: '选择文件夹' }
          : { multiple: true, title: '选择文件' }
      );
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length) onAddPaths?.(paths);
    } catch (err) {
      console.error('[AttachMenu] native dialog failed:', err);
    }
  }, [desktop, onAddPaths]);

  const submitUrl = () => {
    const url = urlValue.trim();
    if (!url) return;
    onAddUrl?.(url);
    setUrlValue('');
    setUrlOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'group inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors',
              'hover:bg-accent hover:text-foreground'
            )}
            title="添加附件"
            aria-label="添加附件"
          >
            <NewIcon
              size={16}
              className="transition-transform duration-150 group-data-[state=open]:rotate-45"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuItem onSelect={() => onPickImage?.()}>
            <ImageIcon className="shrink-0" />
            <span className="flex-1">选择图片</span>
            <span className="text-[10px] text-muted-foreground/60">支持粘贴拖拽</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              // 稍延迟再开 Dialog，避开下拉菜单关闭时的焦点竞争
              window.setTimeout(() => {
                setUrlOpen(true);
                window.setTimeout(() => urlInputRef.current?.focus(), 30);
              }, 10);
            }}
          >
            <GlobeIcon className="shrink-0" />
            <span className="flex-1">添加链接</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!desktop} onSelect={() => void pickPaths(false)}>
            <FileIcon className="shrink-0" />
            <span className="flex-1">选择文件</span>
            <span className="text-[10px] text-muted-foreground/50">{desktop ? '原生对话框' : '仅桌面端'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!desktop} onSelect={() => void pickPaths(true)}>
            <FolderIcon className="shrink-0" />
            <span className="flex-1">选择文件夹</span>
            <span className="text-[10px] text-muted-foreground/50">{desktop ? '原生对话框' : '仅桌面端'}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 链接输入对话框 — 粘贴网址插入输入框 */}
      <Dialog
        open={urlOpen}
        onOpenChange={(open) => {
          setUrlOpen(open);
          if (!open) setUrlValue('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加链接</DialogTitle>
            <DialogDescription>粘贴网址，将插入输入框，随消息一起发送</DialogDescription>
          </DialogHeader>
          <input
            ref={urlInputRef}
            type="text"
            inputMode="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitUrl();
              }
            }}
            placeholder="https://example.com"
            className="desktop-input-chrome h-9 w-full rounded-md border px-3 text-sm outline-none"
            autoComplete="off"
            spellCheck="false"
          />
          <DialogFooter>
            <button
              onClick={() => setUrlOpen(false)}
              className="h-8 cursor-pointer rounded-md px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
            >
              取消
            </button>
            <button
              onClick={submitUrl}
              disabled={!urlValue.trim()}
              className="h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              添加
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
