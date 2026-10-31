/**
 * AppShell — layout shell
 *
 * Pure layout component. Renders:
 *   1. Titlebar (passed as element)
 *   2. Main content (existing .layout flex structure passed as children)
 *
 * No logic — just structure. The existing flex-based .layout class continues
 * to work. PaneShell integration happens at the .layout level in App.jsx.
 *
 * 🔴 2026-10-31 老大：底部状态栏整条下线——左下「已连接」状态、
 *   Agent 名、右下 ID 三处都不要。StatusBar.tsx 保留备查，不再挂载。
 */
interface AppShellProps {
  titlebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppShell({ titlebar, children }: AppShellProps) {
  return (
    <>
      {titlebar}
      {children}
    </>
  );
}
