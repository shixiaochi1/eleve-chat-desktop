/**
 * AppShell — layout shell
 *
 * Pure layout component. Renders:
 *   1. Titlebar (passed as element)
 *   2. Main content (existing .layout flex structure passed as children)
 *   3. StatusBar at bottom
 *
 * No logic — just structure. The existing flex-based .layout class continues
 * to work. PaneShell integration happens at the .layout level in App.jsx.
 */
import StatusBar from './StatusBar';

interface AppShellProps {
  titlebar: React.ReactNode;
  children: React.ReactNode;
  connectionStatus?: string;
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  sessionId?: string | null;
  modelName?: string;
  profileName?: string;
  tokensIn?: number;
  tokensOut?: number;
  onOpenSettings?: () => void;
}

export default function AppShell({
  titlebar,
  children,
  connectionStatus,
  gatewayOnline,
  gatewayChecking,
  sessionId,
  modelName,
  profileName,
  tokensIn,
  tokensOut,
  onOpenSettings,
}: AppShellProps) {
  return (
    <>
      {titlebar}
      {children}
      <StatusBar
        connectionStatus={connectionStatus}
        gatewayOnline={gatewayOnline}
        gatewayChecking={gatewayChecking}
        sessionId={sessionId ?? undefined}
        modelName={modelName}
        profileName={profileName}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
