//! 交互式 PTY 管理器 — 右栏用户终端的真实 shell
//! （对齐 Hermes Electron 主进程 terminalApi：start/input/resize/dispose + onData/onExit）
//!
//! 架构决策：
//! - portable-pty（ConPTY/forkpty）— 与后端后台进程同款 crate，不重复造轮子
//! - PTY 生命周期在应用层（Tauri host），不进 eleved 会话机制 —
//!   对齐 Hermes "终端独立于 session/project 状态，只继承创建时 cwd"
//! - Channel/事件模式：reader 线程 → app.emit（框架事件通道，
//!   与 preview_file_watch 同款）— 零回调反模式
//! - dispose = drop writer(EOF) + kill child；应用退出 cleanup_and_exit → dispose_all

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct PtyEntry {
    /// 写入端 — take_writer 只能调一次，持有于此；drop 发送 EOF
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    /// 子进程句柄 — dispose 时 kill 防孤儿；reader 线程 EOF 后 take 去 wait
    child: Mutex<Option<Box<dyn portable_pty::Child + Send>>>,
}

#[derive(Default)]
pub struct PtyManager {
    entries: Mutex<HashMap<String, Arc<PtyEntry>>>,
}

#[derive(Serialize)]
pub struct PtyStartResult {
    pub id: String,
    pub shell: String,
}

/// 解析默认交互 shell：
/// - ELEVE_SHELL 环境变量覆盖（调试用）
/// - Windows: pwsh → powershell → COMSPEC（按 PATH 探测）
/// - Unix: $SHELL → /bin/bash
fn resolve_default_shell() -> (String, String) {
    if let Ok(s) = std::env::var("ELEVE_SHELL") {
        if !s.is_empty() {
            let name = std::path::Path::new(&s)
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "shell".into());
            return (s, name);
        }
    }
    #[cfg(target_os = "windows")]
    {
        for cand in ["pwsh.exe", "powershell.exe"] {
            if let Ok(out) = std::process::Command::new("where").arg(cand).output() {
                if out.status.success() {
                    let first = String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty());
                    if let Some(path) = first {
                        return (path, cand.trim_end_matches(".exe").to_string());
                    }
                }
            }
        }
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        (comspec, "cmd".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "shell".into());
        (shell, name)
    }
}

/// 返回 data 中最长完整 UTF-8 前缀长度（尾部不完整多字节留给下次拼接，
/// 防 4KB/8KB 读边界把多字节字符劈成 replacement char）
fn complete_utf8_prefix(data: &[u8]) -> usize {
    let len = data.len();
    for trim in 0..std::cmp::min(4, len) {
        let end = len - trim;
        if std::str::from_utf8(&data[..end]).is_ok() {
            return end;
        }
    }
    0
}

#[tauri::command]
pub fn pty_start(
    app: AppHandle,
    manager: State<PtyManager>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<PtyStartResult, String> {
    let (shell_path, shell_name) = resolve_default_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let mut cmd = CommandBuilder::new(&shell_path);
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        if std::path::Path::new(dir).is_dir() {
            cmd.cwd(dir);
        }
    }
    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {}", e))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {}", e))?;

    let id = format!(
        "pty-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
        std::process::id()
    );
    let entry = Arc::new(PtyEntry {
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
        child: Mutex::new(Some(child)),
    });
    manager.entries.lock().unwrap().insert(id.clone(), entry.clone());

    // Reader 线程 → app.emit（阻塞 IO 用 std::thread，与后端 PTY reader 同款）
    let emit_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let end = complete_utf8_prefix(&pending);
                    if end > 0 {
                        let data = String::from_utf8_lossy(&pending[..end]).to_string();
                        pending.drain(..end);
                        let _ = app.emit(
                            "pty-output",
                            serde_json::json!({ "id": emit_id, "data": data }),
                        );
                    }
                }
            }
        }
        // EOF — 等子进程退出码（child 已被 dispose take 走则跳过，防互锁）
        let code = {
            let mut taken = entry.child.lock().unwrap().take();
            taken.as_mut().and_then(|c| c.wait().ok()).map(|s| s.exit_code() as i32)
        };
        let _ = app.emit(
            "pty-exited",
            serde_json::json!({ "id": emit_id, "code": code }),
        );
    });

    Ok(PtyStartResult { id, shell: shell_name })
}

#[tauri::command]
pub fn pty_write(manager: State<PtyManager>, id: String, data: String) -> Result<(), String> {
    let entry = manager.entries.lock().unwrap().get(&id).cloned();
    let Some(entry) = entry else {
        return Err("pty not found".into());
    };
    let mut guard = entry.writer.lock().unwrap();
    match guard.as_mut() {
        Some(w) => w.write_all(data.as_bytes()).map_err(|e| e.to_string()),
        None => Err("pty closed".into()),
    }
}

#[tauri::command]
pub fn pty_resize(manager: State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let entry = manager.entries.lock().unwrap().get(&id).cloned();
    let Some(entry) = entry else {
        return Err("pty not found".into());
    };
    // 🔴 先落局部变量再返回：链式表达式的 MutexGuard 临时值活到语句末，
    // 与 entry 的 Drop 顺序冲突（E0597）
    let result = entry
        .master
        .lock()
        .unwrap()
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn pty_dispose(manager: State<PtyManager>, id: String) -> Result<(), String> {
    let entry = manager.entries.lock().unwrap().remove(&id);
    if let Some(entry) = entry {
        dispose_entry(&entry);
    }
    Ok(())
}

/// drop writer(EOF) + kill child。child 先 take 出锁外再 kill，
/// 避免与 reader 线程的 wait() 争锁
fn dispose_entry(entry: &PtyEntry) {
    drop(entry.writer.lock().unwrap().take());
    let mut child = entry.child.lock().unwrap().take();
    if let Some(c) = child.as_mut() {
        let _ = c.kill();
    }
}

/// 应用退出清理 — cleanup_and_exit 调用，防止 PTY 子进程残留
pub fn dispose_all(app: &AppHandle) {
    if let Some(manager) = app.try_state::<PtyManager>() {
        let entries: Vec<Arc<PtyEntry>> =
            manager.entries.lock().unwrap().drain().map(|(_, v)| v).collect();
        for entry in entries {
            dispose_entry(&entry);
        }
    }
}
