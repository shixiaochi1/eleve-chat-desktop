/**
 * terminal-extras — 终端链接/剪贴板/选区/路径引用（对齐 Hermes terminal 模块
 * links.ts + clipboard.ts + selection.ts 全量语义）
 *
 * - 链接：WebLinksAddon + OSC 8 linkHandler 都走 opener openUrl（Hermes 注释：
 *   window.open 被 Tauri 拒绝，点击无反应）；⌘/Ctrl+click 激活（VS Code/iTerm 共识，
 *   裸点击属于选区，防误触）
 * - 剪贴板：xterm canvas 选区非 DOM 选区 → mirrorSelection 镜像到 helper textarea
 *   让系统 ⌘C/右键复制生效；Ctrl+Shift+C/V + 智能 Ctrl+C（有选区复制、无选区 SIGINT）
 * - 选区：⌘/Ctrl+L 入聊天 + shell:行号 label + 浮动按钮定位
 */
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { CSSProperties } from 'react';
import type { ILinkHandler, Terminal } from '@xterm/xterm';
import { isDesktop } from '@/utils/bridge';

// ── 外部链接（对齐 Hermes lib/external-link + setWindowOpenHandler 拒绝后的桥接）──
export async function openExternalLink(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch { /* fall through to window.open */ }
  }
  window.open(url, '_blank', 'noopener');
}

export const isMacPlatform = () =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');

// ⌘-click (macOS) / Ctrl-click (elsewhere) — VS Code 集成终端/Terminal.app/iTerm2 共识；
// 裸点击属于选区，防误触（⌥ 是强制选择拖拽，不参与）
export function isTerminalLinkActivation(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
  isMac = isMacPlatform(),
): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

const activate = (event: MouseEvent, uri: string) => {
  if (isTerminalLinkActivation(event)) {
    void openExternalLink(uri);
  }
};

/** OSC 8 hyperlink handler（gh/cargo/npm/ls --hyperlink 发出的超链接） */
export const terminalLinkHandler: ILinkHandler = { activate };

/** WebLinksAddon（缓冲区里发现的 URL） */
export const terminalWebLinksAddon = () => new WebLinksAddon(activate);

// ── 剪贴板（对齐 Hermes clipboard.ts）──
export type TerminalClipboardIntent = 'copy' | 'paste' | null;

/**
 * 复制/粘贴和弦判定（VS Code terminal.clipboard 语义）：
 * - Mac：⌘C/⌘V（⌘C 无选区放行到 shell——⌘ 在终端不是修饰键，无副作用）
 * - 其它：Ctrl+Shift+C/V；裸 Ctrl+C 仅在有选区时复制，无选区保持 SIGINT
 */
export function terminalClipboardIntent(
  event: KeyboardEvent,
  { hasSelection, isMac }: { hasSelection: boolean; isMac: boolean },
): TerminalClipboardIntent {
  if (event.type !== 'keydown' || event.altKey) return null;
  const key = event.key.toLowerCase();

  if (isMac) {
    if (!event.metaKey || event.ctrlKey || event.shiftKey) return null;
    return key === 'c' ? (hasSelection ? 'copy' : null) : key === 'v' ? 'paste' : null;
  }

  if (!event.ctrlKey || event.metaKey) return null;
  if (event.shiftKey) {
    return key === 'c' ? (hasSelection ? 'copy' : null) : key === 'v' ? 'paste' : null;
  }
  return key === 'c' && hasSelection ? 'copy' : null;
}

/**
 * 把终端选区镜像进 xterm 的 helper textarea（Hermes 同款：xterm 渲染 canvas，
 * 选区不是 DOM 选区 → 系统复制命令/右键菜单找不到可复制内容）。
 * 仅当终端持有焦点且终端外无选区时 claim（防残留终端选区抢 ⌘C）。
 */
export function mirrorSelection(host: HTMLElement, text: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
  if (!textarea) return;

  if (!text) {
    textarea.value = '';
    return;
  }

  textarea.value = text;
  if (!host.contains(document.activeElement)) return;

  const live = window.getSelection();
  const foreign = live && !live.isCollapsed && live.anchorNode != null && !host.contains(live.anchorNode);
  if (foreign) return;

  textarea.select();
}

// ── 选区入聊天（对齐 Hermes selection.ts）──
export function isAddSelectionShortcut(event: KeyboardEvent): boolean {
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
  return mod && !event.shiftKey && event.key.toLowerCase() === 'l';
}

/** label：shell:起始行 或 shell:起始行-结束行（同 shell 名跨行） */
export function terminalSelectionLabel(term: Terminal, shellName: string, text: string): string {
  const pos = term.getSelectionPosition();
  if (pos) {
    return pos.start.y === pos.end.y ? `${shellName}:${pos.start.y}` : `${shellName}:${pos.start.y}-${pos.end.y}`;
  }
  const lines = Math.max(1, text.trim().split(/\r?\n/).length);
  return `${shellName}:${lines} line${lines === 1 ? '' : 's'}`;
}

/** 浮动按钮定位：贴 xterm 选区（.xterm-selection div）右下角，越界钳制 */
export function terminalSelectionAnchor(host: HTMLDivElement): CSSProperties | null {
  const rect = Array.from(host.querySelectorAll<HTMLElement>('.xterm-selection div'))
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .at(-1);
  if (!rect) return null;

  const hostRect = host.getBoundingClientRect();
  const buttonWidth = 128;
  const left = Math.min(Math.max(rect.left - hostRect.left, 8), Math.max(8, host.clientWidth - buttonWidth - 8));
  const top = Math.min(Math.max(rect.bottom - hostRect.top + 4, 8), Math.max(8, host.clientHeight - 34));
  return { left, top };
}

// ── 拖拽路径按 shell 转义（对齐 Hermes quotePathForShell；ELEVE 旧版只空格加引号）──
export function quotePathForShell(path: string, shellName: string): string {
  const shell = shellName.toLowerCase();
  if (shell.includes('powershell') || shell.includes('pwsh')) {
    return `'${path.replace(/'/g, "''")}'`;
  }
  if (shell.includes('cmd')) {
    return `"${path.replace(/"/g, '""')}"`;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

// ── OSC 7 / OSC 9;9 cwd 追踪（对齐 Hermes parseOscCwd；restoreCwd 数据源）──
/**
 * 从 cwd 上报的 OSC 载荷解析工作目录：
 * - OSC 7（file://host/path，bash/zsh 集成常见）
 * - OSC 9;9（ConEmu/Windows Terminal 风格，部分 PowerShell 配置输出）
 * 无法识别 → null（调用方忽略）
 */
export function parseOscCwd(code: 7 | 9, payload: string): string | null {
  if (code === 9) {
    if (!payload.startsWith('9;')) return null;
    const raw = payload.slice(2).trim().replace(/^"|"$/g, '');
    return raw || null;
  }
  // OSC 7 — file URI：剥 scheme + authority + percent-decode
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(payload.trim());
  if (!match) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 非合法 percent-encoding → 保留未解码路径
  }
  // Windows file URI 盘符前有前导斜杠（/C:/Users）
  const windows = /^\/[A-Za-z]:[\\/]/.exec(raw);
  return (windows ? raw.slice(1) : raw) || null;
}
