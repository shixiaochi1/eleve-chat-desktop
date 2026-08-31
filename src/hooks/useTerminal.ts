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
import { writeClipboardText } from '@/components/ui/copy-button';
// 🔴 2026-08-18 老大需求：终端色板主题化——不再硬编码 macOS 深色板
import { useTheme, deriveTerminalTheme } from '../themes';

// 🔴 2026-08-13 Phase 2.2：scrollback 配置化起点（内存大头——xterm 每行保留 DOM/buffer；
// 后端 config.yaml 暂无对应字段，先常量提出便于未来配置接线；对齐 Hermes PERSISTENT_SESSION_SCROLLBACK 语义）
export const TERMINAL_SCROLLBACK = 1000;

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
  // 🔴 2026-09-01 内存修复（审查 P1-2）：async init 卸载竞态的代数令牌
  const initGenerationRef = useRef(0);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // 🔴 2026-08-18 终端色板主题化：消费主题派生色（浅色模式获得浅底终端，
  // 深色/玻璃模式自动跟随；主题色/外观切换即时热更）
  const { colors, isDark } = useTheme();
  const termTheme = useMemo(() => deriveTerminalTheme(colors, isDark), [colors, isDark]);
  const termThemeRef = useRef(termTheme);
  termThemeRef.current = termTheme;

  // 主题变化 → xterm 热切换 theme（不重建终端/PTY；对齐字体热切换同款节奏）
  useEffect(() => {
    const term = terminalRef.current;
    if (!initializedRef.current || !term) return;
    term.options.theme = termThemeRef.current;
  }, [termTheme]);

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

    // 🔴 2026-09-01 内存修复（审查 P1-2）：异步 init 卸载竞态——代数失效机制
    // （每次 init 自增新代；cleanup 也自增使进行中的 init 失效；旧代 IIFE 在
    // 检查点放弃。StrictMode 双挂载安全：第二次 mount 的 init 持新代，第一次
    // 的旧代在检查点 1 放弃）。原实现 cleanup 只 dispose terminalRef 当时
    // 已有的实例 → await 期间卸载后创建的 xterm + WebGL 实例永不释放
    // （WebGL context 是显存级重资源）。
    const generation = ++initGenerationRef.current;

    (async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { Unicode11Addon } = await import('@xterm/addon-unicode11');
        const { WebglAddon } = await import('@xterm/addon-webgl');

        // 竞态检查点 1：动态 import 期间已卸载/重启 → 零资源创建直接放弃
        if (initGenerationRef.current !== generation) return;

        const fitAddon = new FitAddon();

        // 预热字体（WebGL 字形 atlas 需要；本地已装字体时快，未装不阻塞挂载）
        const bootFont = resolveTerminalFontFamily(getTerminalFontSnapshot());
        void warmTerminalFontFamily(bootFont);

        const term = new Terminal({
          // 🔴 xterm 6.0 必须：proposed API 需显式开启，否则 new Terminal() 直接抛错
          //   （“You must set the allowProposedApi option to true”→ terminalRef 空 →
          //   终端全空白。对齐 Hermes use-terminal-session.ts L508 同配置）
          allowProposedApi: true,
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          fontFamily: bootFont,
          // 对齐 Hermes：opaque canvas（allowTransparency=false 走清晰渲染路径）
          allowTransparency: false,
          convertEol: true,
          scrollback: TERMINAL_SCROLLBACK,
          // 对齐 Hermes：VS Code 4.5:1 对比钳制（默认 1 关闭 → 饱和 ANSI 在浅底上刺眼）
          minimumContrastRatio: 4.5,
          // ⌥-drag 强制选择（鼠标模式 TUI 里拖不动选区）；altClickMovesCursor 抢同一手势
          altClickMovesCursor: false,
          macOptionClickForcesSelection: true,
          macOptionIsMeta: true,
          // OSC 8 hyperlink（gh/cargo/npm/ls --hyperlink）走 opener（Hermes 注释：
          // 默认 window.open 被 Tauri 拒绝 + raw confirm() 死胡同）
          linkHandler: terminalLinkHandler,
          // 🔴 2026-08-18 主题化：原硬编码 macOS 深色板（#1c1c1e/#e5e5e7/#0a84ff…）
          // → deriveTerminalTheme(colors, isDark)——16 色 ANSI 全量跟随主题
          theme: termThemeRef.current,
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
            void writeClipboardText(text).catch(() => {
              // 剪贴板不可用 — 选区保留可重试（Hermes 同款）
            });
            term.clearSelection();
            return false;
          }
          void (async () => {
            try {
              const text = window.eleveDesktop?.readClipboard 
                ? await window.eleveDesktop.readClipboard()
                : await navigator.clipboard.readText();
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

        // 竞态检查点 2：cleanup 已跑 → 立即释放刚创建的实例（含 WebGL addon）
        if (initGenerationRef.current !== generation) {
          try { term.dispose(); } catch { /* ignore */ }
          return;
        }

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
      // 🔴 2026-09-01 内存修复（审查 P1-2）：使进行中的 async init 失效
      //（代数自增 → await 期间卸载的 init 在检查点自行 dispose 新建实例）
      initGenerationRef.current++;
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
