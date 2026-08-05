/**
 * PreviewCenter — 多 Tab 预览中心（对齐 Hermes ChatPreviewRail + PreviewPane 分派）
 *
 * - 顶部 tab 条：url / file 两种 target；右键菜单（关闭/关闭其它/关闭右侧/全部关闭）
 * - 内容区按 active tab 的 target.kind 分派：
 *   - url  → PreviewWebPane（URL 输入 + iframe + 重启）
 *   - file → PreviewFilePane（本地文件渲染）
 *
 * 产物（artifact）保持独立 ArtifactPanel tab——ELEVE 已有功能等价（版本累加/全屏/下载）
 * 的独立面板，不并入预览中心（避免重复造轮子）。
 */

import { File, Globe, X } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  selectTab,
  usePreviewStore,
} from '@/store/preview';
import PreviewWebPane from './PreviewWebPane';
import PreviewFilePane from './PreviewFilePane';

interface PreviewCenterProps {
  sessionId?: string | null;
  cwd?: string;
}

function PreviewTabBar() {
  const { tabs, activeId } = usePreviewStore();

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-[var(--ui-bg-quaternary)] overflow-x-auto shrink-0">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const hasOthers = tabs.length > 1;
        const hasTabsToRight = index < tabs.length - 1;

        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  'group/tab flex items-center gap-1.5 pl-2 pr-1 py-1 text-xs cursor-pointer select-none border-r border-border/60',
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
    </div>
  );
}

export default function PreviewCenter({ sessionId, cwd }: PreviewCenterProps) {
  const { tabs, activeId } = usePreviewStore();
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PreviewTabBar />
      {activeTab ? (
        activeTab.target.kind === 'url' ? (
          <PreviewWebPane key={activeTab.id} tab={activeTab} sessionId={sessionId} cwd={cwd} />
        ) : (
          <PreviewFilePane key={activeTab.id} tab={activeTab} />
        )
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-[var(--ui-text-quaternary)] gap-2">
          <Globe size={32} strokeWidth={1} />
          <span className="text-xs">暂无预览</span>
          <span className="text-[10px] text-[var(--ui-text-quaternary)]/70">
            输入 URL、打开文件，或让 Agent 用 open_preview 打开
          </span>
        </div>
      )}
    </div>
  );
}
