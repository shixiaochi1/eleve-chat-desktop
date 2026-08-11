/**
 * 原生目录选择（单一权威源，禁止各组件重复实现）
 *
 * tauri-plugin-dialog 原生目录对话框；浏览器模式返回 null（调用方自行兜底）。
 * 消费方：FileBrowserPanel / ProjectTreePanel / WorkspaceSettings / SystemSettings 等。
 */
export async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    // 🔴 2026-08-12 修复（老大反馈：点路径跳转到"最后新建项目目录"）：
    //   原生对话框不传 defaultPath 会记忆上次选择的目录 → 打开定位错位。
    //   传入当前目录后选择器打开即定位到当前位置，不再跳走。
    const sel = await open({ directory: true, multiple: false, title, ...(defaultPath ? { defaultPath } : {}) });
    return Array.isArray(sel) ? (sel[0] ?? null) : sel;
  } catch (err) {
    console.error('[pickDirectory] directory dialog failed:', err);
    return null;
  }
}
