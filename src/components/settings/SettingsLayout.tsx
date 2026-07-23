import type { ReactNode } from 'react';

/**
 * SettingsLayout — split layout container
 *
 * Left sidebar navigation + right scrollable content area.
 * Sidebar: nav (scrollable) + footer (fixed, for global actions like import/export).
 */
export default function SettingsLayout({ nav, footer, children }: { nav: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-row h-full">
      <div className="w-48 shrink-0 border-r border-border flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-border p-2">
            {footer}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
