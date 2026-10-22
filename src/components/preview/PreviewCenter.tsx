/**
 * PreviewCenter — 多 Tab 预览中心（对齐 Hermes ChatPreviewRail + PreviewPane 分派）
 *
 * 🔴 2026-10-23 S1 多 webview 保活（对齐 Hermes：每 preview tab 持有独立 webview，
 * pane 隐藏不销毁——切 tab 不再销毁重建，SPA 路由/表单/滚动/console 日志/URL
 * 历史全部保留；对齐 Hermes preview-tile zone 模型 per-tabId 常驻）：
 * - mountedIds：曾激活过的 tab 集合——首次可见才挂载（webview create 需要真实
 *   坐标尺寸，对齐右栏 previewMounted 先例），此后常驻
 * - 非激活 pane 用 hidden 包裹 → 容器 rect 0×0 → ResizeObserver 把 webview
 *   折叠（对齐右栏 pane 级折叠先例；webview 常驻不销毁，激活后展开）
 * - tab 关闭 → 移出 mountedIds → React 卸载该 pane → usePreviewWebview cleanup
 *   → Rust close + registry 注销
 *
 * - 顶部 tab 条：url / file 两种 target；右键菜单（关闭/关闭其它/关闭右侧/全部关闭）
 * - 内容区按各 tab 的 target.kind 分派：
 *   - url  → PreviewWebPane（URL 输入 + webview + 重启）
 *   - file → PreviewFilePane（本地文件渲染）
 *
 * 产物（artifact）保持独立 ArtifactPanel tab——ELEVE 已有功能等价（版本累加/全屏/下载）
 * 的独立面板，不并入预览中心（避免重复造轮子）。
 */

import { File, Globe, X, ExternalLink, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { usePreviewDirty } from '@/lib/preview-edit';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { getCurrentSessionCwd } from '@/lib/session-cwd';
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  newBrowserTab,
  openPreview,
  selectTab,
  usePreviewStore,
  type PreviewTab,
} from '@/store/preview';
import PreviewWebPane from './PreviewWebPane';
import PreviewFilePane from './PreviewFilePane';
import ArtifactPreviewPane from './ArtifactPreviewPane';

interface PreviewCenterProps {
  sessionId?: string | null;
  cwd?: string;
}

/** 脏标记圆点（对齐 Hermes preview-edit.ts modified dot：仅 file tab 消费） */
function DirtyDot({ url }: { url: string }) {
  const dirty = usePreviewDirty(url);
  if (!dirty) return null;
  return <span className="w-1.5 h-1.5 rounded-full bg-[var(--ui-yellow)] shrink-0" title="有未保存的编辑" />;
}

function PreviewTabBar() {
  const { tabs, activeId } = usePreviewStore();

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-quaternary)] overflow-x-auto shrink-0">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const hasOthers = tabs.length > 1;
        const hasTabsToRight = index < tabs.length - 1;

        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  'group/tab flex items-center gap-1.5 pl-2 pr-1 py-1 text-xs cursor-pointer select-none border-r border-[var(--ui-stroke-tertiary)]',
                  active
                    ? 'text-foreground bg-[var(--ui-bg-editor)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'
                )}
                onClick={() => selectTab(tab.id)}
                title={tab.target.url}
              >
                {tab.target.kind === 'url' ? (
                  <Globe size={12} className="shrink-0 text-info" />
                ) : (
                  <File size={12} className="shrink-0 text-warning" />
                )}
                <span className="max-w-36 truncate">{tab.label}</span>
                {/* 文件预览未保存编辑的「已修改」圆点（对齐 Hermes dirty dot） */}
                {tab.target.kind === 'file' && <DirtyDot url={tab.target.url} />}
                <button
                  className="p-0.5 rounded text-muted-foreground/50 opacity-0 group-hover/tab:opacity-100 hover:text-foreground hover:bg-accent/50 transition-opacity shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title="关闭"
                >
                  <X size={11} />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                关闭
                <span className="ml-auto pl-4 text-[var(--ui-text-tertiary)]">Ctrl/⌘+W</span>
              </ContextMenuItem>
              <ContextMenuItem disabled={!hasOthers} onSelect={() => closeOtherTabs(tab.id)}>
                关闭其它
              </ContextMenuItem>
              <ContextMenuItem disabled={!hasTabsToRight} onSelect={() => closeTabsToRight(tab.id)}>
                关闭右侧
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={closeAllTabs}>全部关闭</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {/* 🔴 2026-08-29 对齐 Hermes：工具栏"+"永远 newBrowserTab() 开新 Browser
          tab——"新 tab 是用户主动要的"，不走 browserTabId 归属决策 */}
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/30 hover:text-foreground"
        onClick={() => newBrowserTab()}
        title="新建浏览器标签页"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

/** 空态：无预览 tab 时的手动入口（URL / 文件路径 → 新建 url tab，对齐原 PreviewPanel 输入能力） */
function PreviewEmptyState() {
  const [url, setUrl] = useState('');

  const handleOpen = () => {
    const target = url.trim();
    if (!target) return;
    const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd());
    if (resolved) openPreview(resolved, 'manual');
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 p-4">
      <Globe size={32} strokeWidth={1} className="text-[var(--ui-text-quaternary)]" />
      <span className="text-xs text-[var(--ui-text-quaternary)]">暂无预览</span>
      <div className="flex items-center gap-1.5 w-full max-w-[280px] px-2 py-1.5 rounded border border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
          placeholder="http://localhost:3000 或文件路径"
          className="flex-1 min-w-0 bg-transparent text-xs text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] outline-none border-none"
        />
        <button
          onClick={handleOpen}
          disabled={!url.trim()}
          className="flex items-center justify-center w-6 h-6 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          title="打开预览"
        >
          <ExternalLink size={13} />
        </button>
      </div>
      <span className="text-[10px] text-[var(--ui-text-quaternary)]/70">
        也可让 Agent 用 open_preview 打开，或双击文件树文件
      </span>
    </div>
  );
}

export default function PreviewCenter({ sessionId, cwd }: PreviewCenterProps) {
  const { tabs, activeId } = usePreviewStore();

  // 🔴 S1 mountedIds：曾激活过的 tab（首次可见才挂载 pane——webview create 需要
  //    真实坐标尺寸；之后常驻，hidden 折叠保活）。初始 = 恢复的激活 tab。
  const [mountedIds, setMountedIds] = useState<string[]>(() =>
    activeId ? [activeId] : [],
  );

  // 激活 tab 变化 → 追加进 mountedIds（未激活过的 tab 不挂载，防 N tab 齐发 N create）
  useEffect(() => {
    if (activeId) {
      setMountedIds((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
    }
  }, [activeId]);

  // tabs 收缩（closeTab/closeOther/closeToRight/closeAll）→ 已关闭的 tab 移出
  // mountedIds（React 卸载 pane → usePreviewWebview cleanup → Rust close）
  useEffect(() => {
    setMountedIds((prev) => {
      const next = prev.filter((id) => tabs.some((t) => t.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [tabs]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PreviewTabBar />
      {tabs.length === 0 ? (
        <PreviewEmptyState />
      ) : (
        /* 🔴 S1 per-tab 常驻分派：每个曾激活的 tab 一个 pane 实例，keyed by tab.id；
           非激活 hidden 折叠（webview 0×0 保活），激活的撑满内容区。
           url/file/artifact 组件类型不同，React 按位置自动切换类型——同 kind
           切换纯 prop 更新不重挂 */
        mountedIds.flatMap((tabId) => {
          const tab = tabs.find((t) => t.id === tabId);
          if (!tab) return [];
          const isActive = tabId === activeId;
          return [
            <div
              key={tabId}
              className={isActive ? 'flex flex-col flex-1 min-h-0' : 'hidden'}
            >
              {tab.target.kind === 'url' ? (
                <PreviewWebPane tab={tab} active={isActive} sessionId={sessionId} cwd={cwd} />
              ) : tab.target.kind === 'artifact' ? (
                <ArtifactPreviewPane tab={tab} />
              ) : (
                <PreviewFilePane tab={tab} />
              )}
            </div>,
          ];
        })
      )}
    </div>
  );
}
