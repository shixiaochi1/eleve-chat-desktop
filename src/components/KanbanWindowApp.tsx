/**
 * KanbanWindowApp — 看板独立窗口
 *
 * 1+8 布局：
 * - 1 张背板 = body（var(--theme-background)）
 * - 8 张列卡片放在背板上
 * - 自绘标题栏（和主窗口同 .titlebar，transparent）
 *
 * 主题同步：
 * - 启动时从后端 get_config 读取主题（单一真相源）
 * - 监听 Tauri 事件 theme-changed（主窗口切换时 emit）
 * - 直接 applyThemeCSS，不走 localStorage
 */
import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import KanbanPanel from './KanbanPanel';
import { discoverPort, call } from '../utils/bridge';
import { deriveColors, DEFAULT_ACCENT, type Appearance } from '../themes/derive';
import { applyThemeCSS, loadThemeAppearanceOptions } from '../themes/context';
import { Loader, Minus, Square, X } from 'lucide-react';

export default function KanbanWindowApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);

  const win = getCurrentWindow();
  const winMin = () => { win.minimize().catch(() => {}); };
  const winMax = () => { win.toggleMaximize().catch(() => {}); };
  const winClose = () => { win.close().catch(() => {}); };

  const log = (msg: string) => {
    console.log('[KanbanWindow]', msg);
    setDebug(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
  };

  // 应用主题到 CSS（🔴 2026-08-18 同步外观选项——降低透明度/减弱动态/文字大小
  // 与主窗口一致，多窗口主题体验统一）
  const applyTheme = useCallback((accent: string, appearance: Appearance) => {
    const isDark = appearance === 'dark' || (appearance === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const isGlass = appearance === 'glass';
    const colors = deriveColors(accent, isDark);
    applyThemeCSS(colors, isDark, isGlass, accent, loadThemeAppearanceOptions());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        log('starting discoverPort...');
        const ok = await discoverPort();
        log(`discoverPort returned: ${ok}`);
        if (!ok) {
          throw new Error('discoverPort returned false');
        }

        // 连 WS（get_config 走 WS）
        const { getWsClient } = await import('../services/ws-client');
        const ws = getWsClient();
        if (ws.state === 'disconnected') {
          log('connecting WS...');
          ws.connect();
        }
        if (ws.state !== 'connected') {
          log('waiting for WS connection...');
          await new Promise<void>((resolve) => {
            const unsub = ws.onStateChange((s) => {
              if (s === 'connected') {
                unsub();
                resolve();
              }
            });
            // 10s 超时
            setTimeout(() => { unsub(); resolve(); }, 10000);
          });
        }

        // 从后端读取主题配置
        const cfg = await call('get_config', {}) as { display?: { accent?: string; appearance?: Appearance } } | null;
        // 🔴 2026-08-18 主题化：原 #6366f1 硬编码 fallback → DEFAULT_ACCENT（石墨灰）
        const accent = cfg?.display?.accent || DEFAULT_ACCENT;
        const appearance = cfg?.display?.appearance || 'auto';
        applyTheme(accent, appearance);
        log(`theme loaded: accent=${accent}, appearance=${appearance}`);

        setReady(true);
        log('ready=true, rendering KanbanPanel');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`discoverPort failed: ${msg}`);
        setError('无法连接到后端服务: ' + msg);
      }
    })();
  }, []);

  // 监听主窗口主题切换事件
  useEffect(() => {
    const unlisten = listen<{ accent: string; appearance: Appearance }>('theme-changed', (event) => {
      const { accent, appearance } = event.payload;
      applyTheme(accent, appearance);
      log(`theme-changed: accent=${accent}, appearance=${appearance}`);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // 自绘标题栏（和主窗口同结构，transparent）
  const titlebarEl = (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={winMax}>
      <div className="titlebar-actions">
        <button className="tb-btn" title="最小化" onClick={winMin}><Minus size={14} strokeWidth={1.5} /></button>
        <button className="tb-btn" title="最大化" onClick={winMax}><Square size={12} strokeWidth={1.5} /></button>
        <button className="tb-btn tb-btn-close" title="关闭" onClick={winClose}><X size={14} strokeWidth={1.5} /></button>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col h-screen">
        {titlebarEl}
        <div className="flex flex-col items-center justify-center flex-1 p-4">
          <p className="text-sm text-danger mb-4">{error}</p>
          <div className="text-xs text-muted-foreground font-mono max-h-40 overflow-auto">
            {debug.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-col h-screen">
        {titlebarEl}
        <div className="flex flex-col items-center justify-center gap-2 flex-1">
          <Loader size={16} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--ui-text-tertiary)' }} />
          <span className="text-sm" style={{ color: 'var(--ui-text-tertiary)' }}>连接后端...</span>
          <div className="text-xs text-muted-foreground font-mono mt-2">
            {debug.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {titlebarEl}
      <KanbanPanel />
    </div>
  );
}
