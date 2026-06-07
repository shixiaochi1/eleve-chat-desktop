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

  // 独立窗口也需要发现后端端口
  useEffect(() => {
    (async () => {
      try {
        await discoverPort();
        setReady(true);
      } catch (err) {
        console.error('[KanbanWindow] discoverPort failed:', err);
        setError('无法连接到后端服务');
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--ui-bg-chrome)' }}>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center gap-2 h-screen" style={{ background: 'var(--ui-bg-chrome)' }}>
        <Loader size={16} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--ui-text-tertiary)' }} />
        <span className="text-sm" style={{ color: 'var(--ui-text-tertiary)' }}>连接后端...</span>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--ui-bg-chrome)' }}>
      <KanbanPanel />
    </div>
  );
}
