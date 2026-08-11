/**
 * KanbanWindowApp — 看板独立窗口的应用壳
 *
 * 独立窗口加载 ?panel=kanban 时的入口组件。
 * 只渲染 KanbanPanel + 端口发现，不加载侧栏/聊天等主界面组件。
 * 与主窗口共享同一个 eleved 后端。
 */
import { useState, useEffect } from 'react';
import KanbanPanel from './KanbanPanel';
import { discoverPort } from '../utils/bridge';
import { Loader } from 'lucide-react';

export default function KanbanWindowApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);

  const log = (msg: string) => {
    console.log('[KanbanWindow]', msg);
    setDebug(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
  };

  // 独立窗口也需要发现后端端口
  useEffect(() => {
    (async () => {
      try {
        log('starting discoverPort...');
        const ok = await discoverPort();
        log(`discoverPort returned: ${ok}`);
        if (!ok) {
          throw new Error('discoverPort returned false');
        }
        setReady(true);
        log('ready=true, rendering KanbanPanel');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`discoverPort failed: ${msg}`);
        setError('无法连接到后端服务: ' + msg);
      }
    })();
  }, []);

  // 渲染调试信息
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4" style={{ background: 'var(--ui-bg-chrome)' }}>
        <p className="text-sm text-danger mb-4">{error}</p>
        <div className="text-xs text-muted-foreground font-mono max-h-40 overflow-auto">
          {debug.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-screen" style={{ background: 'var(--ui-bg-chrome)' }}>
        <Loader size={16} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--ui-text-tertiary)' }} />
        <span className="text-sm" style={{ color: 'var(--ui-text-tertiary)' }}>连接后端...</span>
        <div className="text-xs text-muted-foreground font-mono mt-2">
          {debug.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--ui-bg-chrome)' }}>
      <KanbanPanel />
    </div>
  );
}
