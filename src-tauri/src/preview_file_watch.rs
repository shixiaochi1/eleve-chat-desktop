//! 预览文件系统 watcher — 对齐 Hermes electron/main.ts watchPreviewFile
//!
//! 文件预览（file tab）的磁盘变化自动重载：Hermes 用 Electron 主进程 fs.watch
//! （watch 目录 + basename 过滤 + debounce → hermes:preview-file-changed 事件）。
//! ELEVE 等价 = Rust 侧 notify 薄封装（notify 是 Rust 标准文件事件库）：
//!
//!   preview_file_watch(path) -> id
//!     创建 RecommendedWatcher（NonRecursive watch 父目录，捕获编辑器
//!     rename 替换式保存），事件经 mpsc channel 消费线程按 basename 过滤
//!     （目录下其它文件变化不触发）→ app.emit("preview-file-changed", {path})；
//!     watcher 存入注册表（drop 即停止 + channel 关闭 → 消费线程自动退出）
//!   preview_file_unwatch(id)
//!     从注册表 remove → drop watcher → 停止（无显式关闭信号，无泄漏）
//!
//! 事件链路遵循 Rust channel 铁律（非回调）：notify EventHandler 用文档明确
//! 支持的 Sender<Result<Event, Error>> impl（不依赖闭包 blanket impl）。
//! debounce 放前端（单文件事件频率低，200ms 合并；对齐 Hermes FILE_RELOAD_DEBOUNCE_MS）。
//! 与 PreviewConsoleBuffer / PreviewWebviewManager 同构：managed state +
//! 命令入口 + app.emit 事件通道，零新机制。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;

#[derive(Default)]
pub struct PreviewFileWatchManager {
    /// id → watcher（drop 即停止 watch；通道关闭后消费线程退出）
    watches: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    counter: AtomicU64,
}

impl PreviewFileWatchManager {
    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::SeqCst);
        format!("pfw-{}", n)
    }
}

fn base_name(p: &std::path::Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// 启动对单个预览文件的 watch；返回 id（unwatch 用）
#[tauri::command]
pub fn preview_file_watch(
    app: tauri::AppHandle,
    manager: tauri::State<'_, PreviewFileWatchManager>,
    path: String,
) -> Result<String, String> {
    use notify::{RecursiveMode, Watcher};

    if path.trim().is_empty() {
        return Err("preview_file_watch: empty path".into());
    }

    let p = std::path::PathBuf::from(&path);
    let dir = p
        .parent()
        .ok_or_else(|| "preview_file_watch: no parent dir".to_string())?
        .to_path_buf();
    let target_name = base_name(&p);
    if target_name.is_empty() {
        return Err("preview_file_watch: empty file name".into());
    }

    let id = manager.next_id();
    let emit_path = path.clone();
    let emit_name = target_name.clone();

    // notify channel 模式：Sender<Result<Event, Error>> 实现 EventHandler
    // （notify 文档明确列出的 impl）。watch 目录 + basename 过滤 = Hermes 同款
    // 语义（rename 替换式保存也捕获）。
    let (tx, rx) = mpsc::channel::<Result<notify::Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("preview_file_watch: create watcher: {}", e))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("preview_file_watch: watch {}: {}", dir.display(), e))?;

    // 消费线程：basename 过滤 + emit。watcher drop（unwatch）→ notify 内部
    // Sender drop → 通道关闭 → rx.recv() Err → 线程退出（无泄漏、无显式停止信号）
    std::thread::spawn(move || {
        use tauri::Emitter;
        while let Ok(res) = rx.recv() {
            if let Ok(event) = res {
                let hit = event.paths.iter().any(|p| base_name(p) == emit_name);
                if hit {
                    let _ =
                        app.emit("preview-file-changed", serde_json::json!({ "path": emit_path }));
                }
            }
        }
    });

    manager.watches.lock().unwrap().insert(id.clone(), watcher);
    Ok(id)
}

/// 停止 watch（remove → drop watcher → 通道关闭 → 消费线程退出；幂等）
#[tauri::command]
pub fn preview_file_unwatch(
    manager: tauri::State<'_, PreviewFileWatchManager>,
    id: String,
) -> Result<(), String> {
    manager.watches.lock().unwrap().remove(&id);
    Ok(())
}
