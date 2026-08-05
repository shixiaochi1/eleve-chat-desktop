/**
 * useTerminal — Terminal lifecycle hook
 *
 * Creates and manages an @xterm/xterm Terminal instance
 * with FitAddon + WebLinksAddon（走 opener，非 window.open）+ WebGL（fallback DOM）。
 *
 * 对齐 Hermes use-terminal-session 的渲染/交互核心：
 * - linkHandler（OSC 8）+ WebLinksAddon（URL）→ opener openUrl（⌘/Ctrl+click）
 * - attachCustomKeyEventHandler：智能剪贴板（⌘C/⌘V、Ctrl+Shift+C/V、裸 Ctrl+C 有选区才复制）
 * - onSelectionChange → mirrorSelection（canvas 选区镜像进 helper textarea，系统复制生效）
 * - altClickMovesCursor:false + macOptionClickForcesSelection（⌥-drag 强制选择鼠标模式 TUI）
 * - minimumContrastRatio 4.5 / convertEol / scrollback 1000（VS Code 终端视觉语义）
 * - WebGL 渲染器 + context loss 降级 DOM（对齐 Hermes mount 路径）
 * - 字体：warm 后挂载 + 配置变化热切换（applyTerminalFontFamily，不重建 xterm/PTY）
 */
import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { registerTerminalReader, makeTerminalReader, setActiveTerminalId } from '@/store/terminal-buffer';
import {
  terminalLinkHandler,
  terminalWebLinksAddon,
  terminalClipboardIntent,
  mirrorSelection,
  terminalSelectionAnchor,
  isMacPlatform,
} from '@/lib/terminal-extras';
import {
  getTerminalFontSnapshot,
  resolveTerminalFontFamily,
  warmTerminalFontFamily,
  applyTerminalFontFamily,
  useTerminalFontConfigured,
} from '@/lib/terminal-font';

interface UseTerminalOptions {
  lazy?: boolean;
  /** Terminal entry id — used to register the buffer reader for read_terminal tool */
  id?: string;
  /** 选区变化回调（镜像已内部完成；此回调供视图显示浮动按钮 + ⌘L 发送） */
  onSelectionChange?: (text: string, anchor: CSSProperties | null) => void;
}

export default function useTerminal({ lazy = false, id, onSelectionChange }: UseTerminalOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const webglRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const unregisterReaderRef = useRef<(() => void) | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // ── 字体热切换（对齐 Hermes useTerminalFontController）──
  const configuredFont = useTerminalFontConfigured();
  const resolvedFont = useMemo(() => resolveTerminalFontFamily(configuredFont), [configuredFont]);
  const fontGenerationRef = useRef(0);
  useEffect(() => {
    const term = terminalRef.current;
    if (!initializedRef.current || !term || term.options.fontFamily === resolvedFont) return;
    const generation = ++fontGenerationRef.current;
    let cancelled = false;
    void applyTerminalFontFamily({
      clearTextureAtlas: () => webglRef.current?.clearTextureAtlas?.(),
      fit: () => {
        try {
          fitAddonRef.current?.fit();
        } catch { /* ignore */ }
      },
      fontFamily: resolvedFont,
      isCurrent: () => !cancelled && fontGenerationRef.current === generation,
      term,
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedFont]);

  // Create the terminal instance
  const init = useCallback(() => {
    if (initializedRef.current) return;

    (async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { Unicode11Addon } = await import('@xterm/addon-unicode11');
        const { WebglAddon } = await import('@xterm/addon-webgl');

        const fitAddon = new FitAddon();

        // 预热字体（WebGL 字形 atlas 需要；本地已装字体时快，未装不阻塞挂载）
        const bootFont = resolveTerminalFontFamily(getTerminalFontSnapshot());
        void warmTerminalFontFamily(bootFont);

        const term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          fontFamily: bootFont,
          // 对齐 Hermes：opaque canvas（allowTransparency=false 走清晰渲染路径）
          allowTransparency: false,
          convertEol: true,
          scrollback: 1000,
          // 对齐 Hermes：VS Code 4.5:1 对比钳制（默认 1 关闭 → 饱和 ANSI 在浅底上刺眼）
          minimumContrastRatio: 4.5,
          // ⌥-drag 强制选择（鼠标模式 TUI 里拖不动选区）；altClickMovesCursor 抢同一手势
          altClickMovesCursor: false,
          macOptionClickForcesSelection: true,
          macOptionIsMeta: true,
          // OSC 8 hyperlink（gh/cargo/npm/ls --hyperlink）走 opener（Hermes 注释：
          // 默认 window.open 被 Tauri 拒绝 + raw confirm() 死胡同）
          linkHandler: terminalLinkHandler,
          theme: {
            background: '#1c1c1e',
            foreground: '#e5e5e7',
            cursor: '#0a84ff',
            cursorAccent: '#1c1c1e',
            selectionBackground: '#0a84ff40',
            black: '#1c1c1e',
            red: '#ff453a',
            green: '#30d158',
            yellow: '#ff9f0a',
            blue: '#0a84ff',
            magenta: '#bf5af2',
            cyan: '#5ac8fa',
            white: '#e5e5e7',
            brightBlack: '#636366',
            brightRed: '#ff453a',
            brightGreen: '#30d158',
            brightYellow: '#ff9f0a',
            brightBlue: '#0a84ff',
            brightMagenta: '#bf5af2',
            brightCyan: '#5ac8fa',
            brightWhite: '#f5f5f7',
          },
        });

        term.loadAddon(fitAddon);
        // URL 链接走 opener（⌘/Ctrl+click），不 window.open
        term.loadAddon(terminalWebLinksAddon());
        // Unicode 11 宽字符（emoji 等）
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = '11';

        // WebGL 渲染器（对齐 Hermes mount 路径：context loss 时 dispose 降级 DOM）
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            webgl.dispose();
            webglRef.current = null;
          });
          term.loadAddon(webgl);
          webglRef.current = webgl;
        } catch (err) {
          console.warn('[useTerminal] WebGL unavailable; falling back to DOM', err);
        }

        // 智能剪贴板（对齐 Hermes clipboard.ts）：返回 false = xterm 不再把按键发 PTY
        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          const intent = terminalClipboardIntent(event, {
            hasSelection: Boolean(term.getSelection()),
            isMac: isMacPlatform(),
          });
          if (!intent) return true;

          event.preventDefault();
          if (intent === 'copy') {
            const text = term.getSelection();
            void navigator.clipboard.writeText(text).catch(() => {
              // 剪贴板不可用 — 选区保留可重试（Hermes 同款）
            });
            term.clearSelection();
            return false;
          }
          void (async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text) term.paste(text);
            } catch { /* 读剪贴板被拒（无焦点/权限）静默 */ }
          })();
          return false;
        });

        // 选区变化 → 镜像进 helper textarea（系统 ⌘C/右键复制生效）+ 通知视图
        term.onSelectionChange(() => {
          const host = containerRef.current;
          const text = term.getSelection();
          if (host) mirrorSelection(host, text);
          onSelectionChangeRef.current?.(text, host && text.trim() ? terminalSelectionAnchor(host) : null);
        });

        fitAddonRef.current = fitAddon;
        terminalRef.current = term;

        // Attach to container if available
        if (containerRef.current) {
          term.open(containerRef.current);
          setTimeout(() => fitAddon.fit(), 50);
        }

        initializedRef.current = true;

        // 对齐 Hermes: registerTerminalReader(id, makeTerminalReader(term))
        // Agent 的 read_terminal 工具通过此 reader 读取 xterm buffer
        if (id) {
          unregisterReaderRef.current = registerTerminalReader(id, makeTerminalReader(term));
        }
      } catch (err) {
        console.error('[useTerminal] Failed to initialize xterm:', err);
      }
    })();
  }, []);

  // 4-2 修复：id 变化时重新注册 reader（原实现捕获首渲染 id 陈旧闭包，
  // 切 tab 后 readActiveTerminal 查新 id 得 null）。
  // 未初始化时跳过——init 完成后首次 id 已由 init 内注册。
  useEffect(() => {
    if (!initializedRef.current || !terminalRef.current || !id) return;
    if (unregisterReaderRef.current) {
      unregisterReaderRef.current();
      unregisterReaderRef.current = null;
    }
    unregisterReaderRef.current = registerTerminalReader(id, makeTerminalReader(terminalRef.current));
  }, [id]);

  // Lazy init: only init when explicitly called or on mount if not lazy
  useEffect(() => {
    if (!lazy) {
      init();
    }
    return () => {
      // Cleanup buffer reader（对齐 Hermes: unregister on dispose）
      if (unregisterReaderRef.current) {
        unregisterReaderRef.current();
        unregisterReaderRef.current = null;
      }
      // Cleanup terminal
      if (terminalRef.current) {
        try {
          terminalRef.current.dispose();
        } catch { /* ignore */ }
        terminalRef.current = null;
        webglRef.current = null;
        initializedRef.current = false;
      }
    };
  }, [lazy, init]);

  const fit = useCallback(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current.fit();
        } catch { /* ignore */ }
      }, 50);
    }
  }, []);

  const write = useCallback((data: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(data);
    }
  }, []);

  const focus = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.focus();
    }
  }, []);

  const clear = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.clear();
    }
  }, []);

  return {
    containerRef,
    terminalRef,
    webglRef,
    init,
    fit,
    write,
    focus,
    clear,
    initialized: initializedRef,
  };
}
