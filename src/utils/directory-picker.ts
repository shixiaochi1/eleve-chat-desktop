/**
 * 原生目录选择（单一权威源，禁止各组件重复实现）
 *
 * tauri-plugin-dialog 原生目录对话框；浏览器模式返回 null（调用方自行兜底）。
 * 消费方：FileBrowserPanel / ProjectTreePanel / WorkspaceSettings / SystemSettings 等。
 */
export async function pickDirectory(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ directory: true, multiple: false, title });
    return Array.isArray(sel) ? (sel[0] ?? null) : sel;
  } catch (err) {
    console.error('[pickDirectory] directory dialog failed:', err);
    return null;
  }
}
