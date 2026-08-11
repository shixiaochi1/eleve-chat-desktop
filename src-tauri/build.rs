fn main() {
    // 🔴 app ACL manifest：声明全部自定义命令，生成 allow-<命令名> 权限。
    // 必要性（2026-08-05 预览控制台踩坑）：Tauri v2 对远程 origin 的 IPC 强制 ACL——
    // 自定义命令必须（a）在 app manifest 中注册（生成 permission 标识），
    // （b）在对应 capability 的 permissions 中显式声明，远程页面才能调用。
    // 配置后 has_app_acl=true → Local origin 的自定义命令同样严格 ACL，
    // 故 default.json 必须补齐所有 allow-*（否则主窗口命令全部被拒）。
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_gateway_port",
            "get_auto_start",
            "set_auto_start",
            "create_deepseek_webview",
            "toggle_kanban_window",
            "mark_restarting",
            // 预览控制台
            "preview_console_push",
            "preview_console_snapshot",
            "preview_webview_create",
            "preview_webview_close",
            "preview_webview_update",
            "preview_webview_navigate",
            "preview_webview_reload",
            "preview_webview_visible",
            "preview_webview_devtools",
            // 预览文件 watcher
            "preview_file_watch",
            "preview_file_unwatch",
            // 交互式 PTY（右栏用户终端真实 shell）
            "pty_start",
            "pty_write",
            "pty_resize",
            "pty_dispose",
        ]),
    );
    if let Err(e) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {}", e);
    }
}
