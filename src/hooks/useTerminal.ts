/**
 * useTerminal — Terminal lifecycle hook
 *
 * Creates and manages an @xterm/xterm Terminal instance
 * with FitAddon and WebLinksAddon.
 */
import { useEffect, useRef, useCallback } from 'react';
import { registerTerminalReader, makeTerminalReader, setActiveTerminalId } from '@/store/terminal-buffer';

interface UseTerminalOptions {
  lazy?: boolean;
  /** Terminal entry id — used to register the buffer reader for read_terminal tool */
  id?: string;
}

export default function useTerminal({ lazy = false, id }: UseTerminalOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const weblinksAddonRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const unregisterReaderRef = useRef<(() => void) | null>(null);

  // Create the terminal instance
  const init = useCallback(() => {
    if (initializedRef.current) return;

    (async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        const fitAddon = new FitAddon();
        const weblinksAddon = new WebLinksAddon();

        const term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', monospace",
          allowTransparency: true,
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
        term.loadAddon(weblinksAddon);

        fitAddonRef.current = fitAddon;
        weblinksAddonRef.current = weblinksAddon;
        terminalRef.current = term;

        // Attach to container if available
        if (containerRef.current) {
          term.open(containerRef.current);
          setTimeout(() => fitAddon.fit(), 50);
        }

        // Agent terminal: external write() only, no local echo
        // Data source is Agent tool call results, not local PTY
        term.write('\r\n\x1b[32m╔══════════════════════════════════════════╗\x1b[0m\r\n');
        term.write('\x1b[32m║  \x1b[1;37mAgent 终端助手\x1b[0m\x1b[32m                        ║\x1b[0m\r\n');
        term.write('\x1b[32m║  命令由 Agent 远程执行并返回结果              ║\x1b[0m\r\n');
        term.write('\x1b[32m╚══════════════════════════════════════════╝\x1b[0m\r\n');

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
    init,
    fit,
    write,
    focus,
    clear,
    initialized: initializedRef,
  };
}
