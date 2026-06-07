import type { ReactNode } from 'react';

/**
 * SettingsLayout — split layout container
 *
 * Left sidebar navigation + right scrollable content area.
 */
export default function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-row h-full">
      <div className="w-48 shrink-0 border-r border-border overflow-y-auto">
        {nav}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
