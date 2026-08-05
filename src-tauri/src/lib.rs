//! Eleve Chat Desktop — Tauri v2 入口
//!
//! 架构：Tauri 只负责 UI 壳，Agent 运行在独立 eleved 子进程中。
//! setup() 闭包内启动 eleved 子进程（CREATE_NO_WINDOW，无黑窗口），
//! 轮询 gateway_state.json 发现端口，前端通过 get_gateway_port 获取端口后走 HTTP SSE。
//!
//! 对比旧架构：不再内嵌 Agent/Gateway/Tokio Runtime，彻底消除同进程 CPU 争抢。
//!
//! Sidecar 说明（问题 A）：
//!   - Tauri v2 的 externalBin（sidecar）方式需要 tauri-plugin-shell 依赖
//!   - 当前 Cargo.toml 无此依赖，故保留 bundle.resources 打包方式
//!   - eleved.exe 通过 bundle.resources 打包到 app 目录，启动时从同目录查找
//!   - 如需迁移到 sidecar：加 tauri-plugin-shell 依赖 + 改 externalBin 配置 + 二进制命名含 target triple
//!
//! 平台说明（问题 B）：
//!   - agent-browser-win32-x64.exe 仅为 Windows 平台，通过 bundle.resources 打包
//!   - 当前只打 Windows 包，暂不处理跨平台条件配置

use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::time::Duration;

// ═══════════════════════════════════════════════════════════════════════════
// TAURI STATE — 仅存端口、子进程句柄、关闭标志
// ═══════════════════════════════════════════════════════════════════════════

pub struct TauriAppState {
    /// HTTP server 绑定的端口号（0 = 尚未就绪）
    pub gateway_port: Arc<AtomicU16>,
    /// eleved 子进程 PID
    pub eleved_pid: std::sync::Mutex<Option<u32>>,
    /// 是否正在关闭（防止重复 kill）
    pub shutting_down: AtomicBool,
    /// 是否用户主动发起重启（true → eleved 退出后 wait 线程自动拉起新进程）
    pub restarting: AtomicBool,
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: RESOLVE ELEVE_HOME (Tauri 前端侧)
// ═══════════════════════════════════════════════════════════════════════════

/// 解析 Eleve Home 目录（Tauri 前端侧使用）。
///
/// 优先级与 eleve-core::bootstrap::get_eleve_home() 一致：
///   1. ELEVE_HOME 环境变量（非空）
///   2. exe 同级 data/ 目录
///   3. ~/.eleve/
///
/// ⚠️ 不再使用 set_var 污染进程环境变量。
/// eleved 子进程通过 --home CLI 参数接收路径（L251-252），不依赖 env var。
/// Read a User-scoped environment variable from the Windows registry (HKCU\Environment).
/// 对齐 Hermes `apps/desktop/electron/windows-user-env.cjs`：
/// GUI 应用从 Explorer 启动时继承登录时环境变量快照，setx 设置的变量不可见。
#[cfg(target_os = "windows")]
fn read_windows_user_env_var(name: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let stdout = std::process::Command::new("reg")
        .args(["query", r"HKCU\Environment", "/v", name])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;

    if !stdout.status.success() {
        return None;
    }

    let output = String::from_utf8_lossy(&stdout.stdout);
    for line in output.lines() {
        let line = line.trim();
        let parts: Vec<&str> = line.splitn(3, |c: char| c.is_whitespace()).collect();
        if parts.len() >= 3
            && parts[0].eq_ignore_ascii_case(name)
            && (parts[1].eq_ignore_ascii_case("REG_SZ")
                || parts[1].eq_ignore_ascii_case("REG_EXPAND_SZ"))
        {
            let raw_value = parts[2].trim();
            if raw_value.is_empty() {
                return None;
            }
            // Expand %VAR% references (REG_EXPAND_SZ)
            let mut expanded = raw_value.to_string();
            let re = regex::Regex::new(r"%([^%]+)%").ok()?;
            expanded = re
                .replace_all(&expanded, |caps: &regex::Captures| {
                    let var_name = caps.get(1).unwrap().as_str();
                    for (key, val) in std::env::vars() {
                        if key.eq_ignore_ascii_case(var_name) {
                            return val;
                        }
                    }
                    caps.get(0).unwrap().as_str().to_string()
                })
                .into_owned();
            let trimmed = expanded.trim().to_string();
            return if trimmed.is_empty() { None } else { Some(trimmed) };
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn read_windows_user_env_var(_name: &str) -> Option<String> {
    None
}

/// 解析 Eleve Home 目录（Tauri 前端侧使用）
///
/// 对齐 Hermes `resolveHermesHome()` (main.cjs L250-272):
///   1. ELEVE_HOME 环境变量
///   2. Windows 注册表 HKCU\Environment\ELEVE_HOME（绕过 GUI 应用环境变量快照问题）
///   3. %LOCALAPPDATA%\Eleve\（Windows 默认，对齐 Hermes %LOCALAPPDATA%\hermes）
///   4. ~/.eleve/（Legacy 兼容）
///   5. ~/.eleve/（最终 fallback）
fn resolve_eleve_home() -> PathBuf {
    // 1. ELEVE_HOME 环境变量（用户显式配置）
    if let Ok(home) = std::env::var("ELEVE_HOME") {
        if !home.is_empty() {
            eprintln!("[TAURI] ELEVE_HOME from env: {}", home);
            return PathBuf::from(home);
        }
    }

    // 2. Windows 注册表 fallback（对齐 Hermes windows-user-env.cjs）
    //    GUI 应用从 Explorer 启动时继承登录时的环境变量快照，
    //    安装时 setx 设置的 ELEVE_HOME 在当前进程不可见。读注册表绕过。
    if let Some(home) = read_windows_user_env_var("ELEVE_HOME") {
        eprintln!("[TAURI] ELEVE_HOME from registry: {}", home);
        return PathBuf::from(home);
    }

    // 2.5. 🔴 关键修复: exe 同级 data/ 目录（对齐后端 get_eleve_home 步骤2）
    //    NSIS 安装后: $INSTDIR\data\ 是数据目录
    //    首次启动时环境变量可能还未生效（需要重启），直接检查目录存在性
    //    仅 release 构建检查（debug 时 exe 在 target/debug/，data/ 是临时产物）
    #[cfg(not(debug_assertions))]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let data_dir = exe_dir.join("data");
            if data_dir.is_dir() {
                eprintln!("[TAURI] ELEVE_HOME from exe-relative data/: {:?}", data_dir);
                return data_dir;
            }
        }
    }

    // 3. 平台标准目录 + legacy 透明迁移（对齐 Hermes resolveHermesHome main.ts L563-574）
    //    🔴 与后端 eleve-core::bootstrap::resolve_platform_default_home 语义必须保持一致：
    //    新位置为空且 legacy ~/.eleve 已有数据 → 沿用 legacy（不丢状态）；否则用 LOCALAPPDATA。
    #[cfg(target_os = "windows")]
    {
        if let Some(local_appdata) = dirs::data_local_dir() {
            let eleve_home = local_appdata.join("Eleve");
            // honour an existing legacy setup when the new location is empty
            if !eleve_home.is_dir() {
                if let Some(legacy) = dirs::home_dir().map(|h| h.join(".eleve")) {
                    if legacy.is_dir() {
                        eprintln!("[TAURI] ELEVE_HOME from legacy ~/.eleve (migration honour): {:?}", legacy);
                        return legacy;
                    }
                }
            }
            std::fs::create_dir_all(&eleve_home).ok();
            eprintln!("[TAURI] ELEVE_HOME from LOCALAPPDATA: {:?}", eleve_home);
            return eleve_home;
        }
    }

    // 4. POSIX / Windows LOCALAPPDATA 缺失：平台默认即 ~/.eleve（存在则用，否则创建）
    let fallback = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".eleve");
    std::fs::create_dir_all(&fallback).ok();
    eprintln!("[TAURI] ELEVE_HOME fallback: {:?}", fallback);
    fallback
}

// ═══════════════════════════════════════════════════════════════════════════
// TAURI COMMANDS — 3 个（保持前端兼容）
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
async fn get_gateway_port(state: tauri::State<'_, TauriAppState>) -> Result<u16, String> {
    // 优先从原子变量读（快速路径）
    let cached = state.gateway_port.load(Ordering::SeqCst);
    if cached != 0 {
        // 验证缓存端口是否仍然有效（TCP connect 探测，短超时避免误判）
        if let Ok(stream) = std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", cached).parse().unwrap(),
            std::time::Duration::from_millis(500),
        ) {
            drop(stream);
            return Ok(cached);
        }
        // 缓存端口失效——重新从 gateway_state.json 读取
        eprintln!("[TAURI] Cached port {} is stale, re-discovering...", cached);
    }

    // 从 ELEVE_HOME 解析路径，再读 gateway_state.json
    let eleve_home = resolve_eleve_home();
    match discover_gateway_port(&eleve_home) {
        Ok(port) => {
            state.gateway_port.store(port, Ordering::SeqCst);
            eprintln!("[TAURI] Re-discovered gateway port: {}", port);
            Ok(port)
        }
        Err(e) => Err(e),
    }
}

/// 标记用户主动重启（前端发起 restart 前调用）
///
/// eleved 退出后，监控线程见 restarting=true → 自动拉起新 eleved（托管重启）。
/// 重启完成后重置为 false；端口缓存置 0 触发前端 rediscover。
#[tauri::command]
fn mark_restarting(state: tauri::State<'_, TauriAppState>) -> Result<(), String> {
    state.restarting.store(true, Ordering::SeqCst);
    eprintln!("[TAURI] 标记重启中：eleved 退出后自动拉起新进程");
    Ok(())
}

/// 监控 eleved 子进程生命周期（递归：重启后继续监控新进程）
///
/// 决策：
/// - `shutting_down` → 用户退出应用，不重启
/// - `restarting` → 用户主动重启：自动拉起新 eleved（托管重启），更新 pid，端口缓存置 0
/// - 其它 → 意外退出：仅告警（前端将无法连接）
fn spawn_eleved_monitor(
    mut child: std::process::Child,
    app_handle: tauri::AppHandle,
    eleve_home: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        match status {
            Ok(exit_status) => {
                eprintln!("[TAURI] eleved 子进程已退出 (status={})", exit_status);
            }
            Err(e) => {
                eprintln!("[TAURI] eleved 子进程异常: {}", e);
            }
        }
        let Some(state) = app_handle.try_state::<TauriAppState>() else {
            return;
        };
        // 1. 正常关闭（用户退出应用）
        if state.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        // 2. 用户主动重启 → 托管拉起新 eleved
        if state.restarting.swap(false, Ordering::SeqCst) {
            eprintln!("[TAURI] 重启中：自动拉起新 eleved...");
            match start_eleved_process(&eleve_home) {
                Ok(new_child) => {
                    let new_pid = new_child.id();
                    *state.eleved_pid.lock().unwrap() = Some(new_pid);
                    // 端口缓存置 0：get_gateway_port 将重新读 gateway_state.json 发现新端口
                    state.gateway_port.store(0, Ordering::SeqCst);
                    eprintln!("[TAURI] 新 eleved 已拉起 (PID={})，继续监控", new_pid);
                    spawn_eleved_monitor(new_child, app_handle, eleve_home);
                }
                Err(e) => {
                    eprintln!("[TAURI] 拉起新 eleved 失败: {}", e);
                }
            }
            return;
        }
        // 3. 意外退出
        eprintln!("[TAURI] eleved 意外退出！前端将无法连接。");
        // TODO: 可通过 Tauri event 通知前端显示错误
    });
}

#[tauri::command]
fn get_auto_start() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| format!("Failed to open Run key: {}", e))?;
        Ok(run_key.get_value::<String, _>("EleveChat").is_ok())
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(false) }
}

#[tauri::command]
fn set_auto_start(enable: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| format!("Failed to open Run key: {}", e))?;
        let (key, _) = run_key;
        if enable {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to get exe path: {}", e))?;
            key.set_value("EleveChat", &exe_path.to_string_lossy().to_string())
                .map_err(|e| format!("Failed to set auto-start: {}", e))?;
            Ok(true)
        } else {
            match key.delete_value("EleveChat") {
                Ok(()) => Ok(false),
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::NotFound { Ok(false) }
                    else { Err(format!("Failed to remove auto-start: {}", e)) }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = enable; Err("Auto-start is only supported on Windows".into()) }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEEPSEEK EMBED — 子 WebView 创建（带 initialization_script 注入）
// ═══════════════════════════════════════════════════════════════════════════

/// 创建 DeepSeek 嵌入子 WebView（带布局裁剪 + 主题注入）
///
/// 前端通过 invoke('create_deepseek_webview', { x, y, width, height }) 调用。
/// 已存在时复用（show + 重新定位），不重复创建。
/// 注入脚本通过 include_str! 编译期嵌入，零运行时文件依赖。
#[tauri::command]
async fn create_deepseek_webview(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
) -> Result<String, String> {
    use tauri::{LogicalPosition, LogicalSize};

    eprintln!("[TAURI] create_deepseek_webview called: x={}, y={}, w={}, h={}, bg=({},{},{})", x, y, width, height, bg_r, bg_g, bg_b);

    const LABEL: &str = "deepseek-embed";

    // 已存在 → 复用：show + 重新定位 + 聚焦
    for wv in window.webviews() {
        if wv.label() == LABEL {
            eprintln!("[TAURI] DeepSeek webview exists, reusing");
            wv.show().map_err(|e| e.to_string())?;
            wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            wv.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            wv.set_focus().map_err(|e| e.to_string())?;
            return Ok(LABEL.to_string());
        }
    }

    // 组合注入脚本：主题 CSS 通过全局变量传给 inject_js，
    // 由 inject_js 在 DOMContentLoaded 时机统一注入（document-start 时 head 尚不存在，
    // 即时 appendChild 会抛 TypeError 导致 CSS 丢失 —— 这是圆角不生效的根因）
    let theme_css = include_str!("../inject/deepseek-theme.css");
    let inject_js = include_str!("../inject/deepseek-inject.js");
    let init_script = format!(
        "window.__ELEVE_DEEPSEEK_THEME__ = {:?};\nwindow.__ELEVE_DEEPSEEK_BG__ = 'rgb({},{},{})';\n{}",
        theme_css, bg_r, bg_g, bg_b, inject_js
    );

    let url = "https://chat.deepseek.com/"
        .parse()
        .map_err(|e| format!("URL parse error: {}", e))?;

    eprintln!("[TAURI] Building webview...");

    let builder = tauri::webview::WebviewBuilder::new(
        LABEL,
        tauri::WebviewUrl::External(url),
    )
    .initialization_script(&init_script)
    // 颜色匹配法：WebView 原生背景 = Eleve 背板色（不透明）
    // body CSS 做 12px 圆角裁剪，四角露出 WebView 底色 = 背板色 = 视觉无缝
    // （WebView2 子窗口是独立 HWND，不支持逐像素透明合成，不能用 transparent）
    .background_color(tauri::webview::Color(bg_r, bg_g, bg_b, 255))
    .focused(true)
    .disable_drag_drop_handler();

    eprintln!("[TAURI] Calling add_child...");

    let wv = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| {
            eprintln!("[TAURI] add_child FAILED: {}", e);
            format!("create deepseek webview failed: {}", e)
        })?;

    eprintln!("[TAURI] DeepSeek webview created: {}", wv.label());
    Ok(wv.label().to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
// ELEVED 子进程管理
// ═══════════════════════════════════════════════════════════════════════════

/// 定位 eleved 二进制文件
/// 
/// 策略（优先级递减）：
/// 1. ELEVED_PATH 环境变量
/// 2. 当前 exe 同目录（Release 模式：eleved.exe 作为资源已打包在同目录）
/// 3. Dev 模式：从当前 exe 路径向上遍历查找 workspace root（含 Cargo.toml），
///    然后在 target/debug/ 下找 eleved
fn find_eleved_binary() -> Option<PathBuf> {
    // 0. 环境变量优先（方便开发调试）
    if let Ok(path) = std::env::var("ELEVED_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return Some(p);
        }
    }

    let name = if cfg!(target_os = "windows") {
        "eleved.exe"
    } else {
        "eleved"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Release 模式：同目录
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }

            // Release 模式：同目录/binaries/ 子目录（NSIS 安装后 resources 打包位置）
            let binaries_candidate = dir.join("binaries").join(name);
            if binaries_candidate.exists() {
                return Some(binaries_candidate);
            }

            // Dev 模式：从 exe 目录向上查找 workspace root（含 Cargo.toml）
            // 然后去 target/debug/ 下找 eleved
            if let Some(workspace_root) = find_workspace_root(dir) {
                let dev_path = workspace_root.join("target/debug").join(name);
                if dev_path.exists() {
                    return Some(std::fs::canonicalize(&dev_path).unwrap_or(dev_path));
                }
                // 也尝试 target/release/
                let release_path = workspace_root.join("target/release").join(name);
                if release_path.exists() {
                    return Some(std::fs::canonicalize(&release_path).unwrap_or(release_path));
                }
            }
        }
    }
    None
}

/// 从路径开始向上遍历，找到工作区根目录（含 Cargo.toml 且有 [workspace] 段）
///
/// 跳过非 workspace 的 Cargo.toml（如 src-tauri/Cargo.toml 是 Tauri 子项目），
/// 确保定位到 Eleve Agent workspace root。
fn find_workspace_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut current = Some(start.to_path_buf());
    let mut last_workspace_root: Option<PathBuf> = None;
    while let Some(dir) = current {
        let cargo_toml = dir.join("Cargo.toml");
        if cargo_toml.exists() {
            // 检查是否是 workspace root（含 [workspace] 段）
            if let Ok(content) = std::fs::read_to_string(&cargo_toml) {
                if content.contains("[workspace]") {
                    last_workspace_root = Some(dir.clone());
                }
            }
            // 即使没有 [workspace]，也记录为候选（单 crate 场景）
            if last_workspace_root.is_none() {
                last_workspace_root = Some(dir.clone());
            }
        }
        current = dir.parent().map(|p| p.to_path_buf());
    }
    // 优先返回 workspace root，否则返回最深层的 Cargo.toml 目录
    last_workspace_root
}

/// 检查路径是否是打包安装目录
///
/// 对齐 Hermes `isPackagedInstallPath()` (main.cjs L2254-2263)：
/// 打包安装后，process.cwd() 会解析到安装根目录（如 C:\Program Files\Eleve Chat\），
/// 用户在那里执行命令会困惑"我的文件去哪了？"。
///
/// 检测逻辑：
/// - Windows: Program Files, WindowsApps, exe 所在目录
/// - macOS: /Applications/
/// - 开发模式返回 false
fn is_packaged_install_path(path: &std::path::Path) -> bool {
    // 开发模式不检查
    if cfg!(debug_assertions) {
        return false;
    }

    let path_str = path.to_string_lossy().to_lowercase();

    // Windows 安装目录特征
    #[cfg(target_os = "windows")]
    {
        if path_str.contains("program files")
            || path_str.contains("program files (x86)")
            || path_str.contains("windowsapps")
        {
            return true;
        }

        // exe 所在目录
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if path == exe_dir {
                    return true;
                }
            }
        }
    }

    // macOS 安装目录特征
    #[cfg(target_os = "macos")]
    {
        if path_str.contains("/applications/") || path_str.contains(".app/") {
            return true;
        }
    }

    false
}

/// 读取用户配置的项目目录（对齐 Hermes readDefaultProjectDir）
///
/// 从 {ELEVE_HOME}/app-data/settings.json 读取 default_project_dir 字段。
/// 如果目录存在则返回 Some(path)，否则 None（让候选链继续 fallback）。
///
/// 🔴 2026-08-04 审计修复：旧实现手写了一套 ELEVE_HOME 定位链，且用
/// dirs::data_dir()（%APPDATA% Roaming）——与本文件 resolve_eleve_home()
/// 和后端 resolve_platform_default_home（均 %LOCALAPPDATA% Local）分叉，
/// 导致用户配的 default_project_dir 永远读不到。直接复用唯一权威链。
/// 🔴 2026-08-05 W-2 补写入方：前端 SystemSettings 写入该字段；读取侧
/// 兼容 app-data 信封格式（对齐后端 settings_service::unwrap_settings_content）。
fn read_default_project_dir() -> Option<String> {
    let eleve_home = resolve_eleve_home();

    let settings_path = eleve_home.join("app-data").join("settings.json");
    let content = std::fs::read_to_string(&settings_path).ok()?;
    let mut v: serde_json::Value = serde_json::from_str(&content).ok()?;
    // 信封兼容（与后端 unwrap_settings_content 两格式对齐）：
    // 1. {"key":"settings","value":"<json_string>"} — 前端 app-data 包裹写入
    // 2. {"data": {...}} — 历史遗留格式
    if v.get("default_project_dir").is_none() {
        if let Some(inner) = v.get("value").and_then(|x| x.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(inner) {
                v = parsed;
            }
        } else if let Some(data) = v.get("data").cloned() {
            v = data;
        }
    }
    let dir = v.get("default_project_dir")?.as_str()?;
    if dir.trim().is_empty() {
        return None;
    }
    let resolved = PathBuf::from(dir);
    if resolved.is_dir() {
        Some(dir.to_string())
    } else {
        None
    }
}

/// 解析 Eleve 工作目录
///
/// 对齐 Hermes `resolveHermesCwd()` (main.cjs L1631-1655)：
/// 打包安装后，process.cwd() 会解析到安装根目录，不能作为工作目录。
///
/// 优先级：
///   1. 用户配置的项目目录（从 settings.json 读取）— 对齐 Hermes readDefaultProjectDir
///   2. 环境变量 ELEVE_DESKTOP_CWD
///   3. 开发模式：process::current_dir()
///   4. 最终 fallback: 用户 home 目录
fn resolve_eleve_cwd() -> PathBuf {
    let candidates: Vec<Option<String>> = vec![
        // 1. 用户配置的项目目录（对齐 Hermes readDefaultProjectDir）
        read_default_project_dir(),
        // 2. 环境变量覆盖
        std::env::var("ELEVE_DESKTOP_CWD").ok(),
        // 3. 开发模式：当前目录
        if cfg!(debug_assertions) {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        } else {
            None
        },
        // 4. 最终 fallback: 用户 home
        dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
    ];

    for candidate in candidates.into_iter().flatten() {
        let resolved = PathBuf::from(&candidate);

        // 🔴 关键：跳过打包安装路径
        if is_packaged_install_path(&resolved) {
            eprintln!(
                "[TAURI] Skipping packaged install path as cwd: {:?}",
                resolved
            );
            continue;
        }

        if resolved.is_dir() {
            eprintln!("[TAURI] Resolved cwd: {:?}", resolved);
            return resolved;
        }
    }

    // 最终 fallback: 用户 home
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    eprintln!("[TAURI] Fallback to home directory: {:?}", home);
    home
}

/// 启动 eleved 子进程
///
/// - Windows: CREATE_NO_WINDOW 防止黑窗口
/// - 传入 --home 参数指定数据目录
/// - 传入 --no-banner 静默模式
/// - 🔴 设置 current_dir 和 TERMINAL_CWD 环境变量（对齐 Hermes）
/// - stderr 重定向到日志文件
fn start_eleved_process(eleve_home: &PathBuf) -> Result<std::process::Child, String> {
    let binary = find_eleved_binary()
        .ok_or_else(|| {
            let name = if cfg!(target_os = "windows") { "eleved.exe" } else { "eleved" };
            format!(
                "未找到 {} — 请先编译: cargo build -p eleve-bin (查找路径: 同目录 或 target/debug/)",
                name
            )
        })?;
    
    // 🔍 诊断：记录实际使用的 eleved 路径
    eprintln!("[DIAG-eleved-path] Using eleved: {:?}", binary);

    // 🔴 解析工作目录（对齐 Hermes resolveHermesCwd）
    let eleve_cwd = resolve_eleve_cwd();
    eprintln!("[TAURI] Setting eleved cwd to: {:?}", eleve_cwd);

    let mut cmd = std::process::Command::new(&binary);
    cmd.arg("--home")
        .arg(eleve_home.to_string_lossy().as_ref())
        .arg("--no-banner")
        // 🔴 设置 spawn cwd（对齐 Hermes main.cjs L4771）
        .current_dir(&eleve_cwd)
        // 🔴 显式设置环境变量（对齐 Hermes main.cjs L4772-4784）
        .env("ELEVE_HOME", eleve_home.to_string_lossy().as_ref())
        .env("TERMINAL_CWD", eleve_cwd.to_string_lossy().as_ref())
        // 🔴 ELEVE_DESKTOP=1 — 对齐 Hermes HERMES_DESKTOP=1（桌面端 spawn 时设置）
        // gated 工具（close_terminal / read_terminal）通过此变量判断是否可用
        .env("ELEVE_DESKTOP", "1");

    // stdout/stderr 重定向到 runtime/ 目录下的独立捕获文件
    // 与 eleved 自身的 logs/eleved.log (tracing) 分离，避免双写争用
    let runtime_dir = eleve_home.join("runtime");
    std::fs::create_dir_all(&runtime_dir).ok();
    let stdout_log_path = runtime_dir.join("eleved-stdout.log");
    let stdout_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_log_path)
        .map_err(|e| format!("无法创建 stdout 日志文件 {:?}: {}", stdout_log_path, e))?;

    cmd.stdout(std::process::Stdio::from(stdout_log.try_clone().unwrap()));
    cmd.stderr(std::process::Stdio::from(stdout_log));

    // Windows: 不弹黑窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn()
        .map_err(|e| format!("启动 eleved 失败: {} (binary={:?})", e, binary))?;

    let pid = child.id();
    eprintln!("[TAURI] eleved 子进程已启动 (PID={}, binary={:?})", pid, binary);

    Ok(child)
}

/// 轮询 gateway_state.json 获取 eleved 的 HTTP 端口
///
/// eleved 启动后会写入 runtime/gateway_state.json 包含端口号。
/// 自适应退避：前 50 次 100ms（5s）+ 后 30 次 300ms（9s）= 共 14s。
/// eleved 通常 2-5s 内就绪，14s 足覆盖慢启动场景。
fn discover_gateway_port(eleve_home: &PathBuf) -> Result<u16, String> {
    let state_file = eleve_home.join("runtime").join("gateway_state.json");
    let fast_attempts = 50;  // 前 50 次 100ms = 5s
    let slow_attempts = 30;  // 后 30 次 300ms = 9s
    let fast_delay = Duration::from_millis(100);
    let slow_delay = Duration::from_millis(300);
    let total = fast_attempts + slow_attempts;

    for i in 0..total {
        if state_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&state_file) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // 兼容两种 key：gateway_port（新）和 port（旧）
                    let port_val = json.get("gateway_port")
                        .or_else(|| json.get("port"))
                        .and_then(|v| v.as_u64());
                    if let Some(port) = port_val {
                        if port > 0 && port <= 65535 {
                            eprintln!("[TAURI] 端口发现成功: {} (尝试 {}/{})", port, i + 1, total);
                            return Ok(port as u16);
                        }
                    }
                }
            }
        }
        let delay = if i < fast_attempts { fast_delay } else { slow_delay };
        std::thread::sleep(delay);
    }

    let total_secs = fast_attempts as u64 * 200 / 1000 + slow_attempts as u64 * 500 / 1000;
    Err(format!(
        "端口发现超时 ({}s) — 请检查 eleved 是否正常启动，日志: {}/logs/eleved.log 或 {}/runtime/eleved-stdout.log",
        total_secs,
        eleve_home.display(),
        eleve_home.display()
    ))
}

/// 检查 PID 是否存活
fn is_pid_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        // 用 Windows API OpenProcess + GetExitCodeProcess 替代 tasklist 命令
        // tasklist 每次 spawn 进程要 50-100ms，OpenProcess 是内核调用，微秒级
        use windows_sys::Win32::System::Threading::{OpenProcess, GetExitCodeProcess};
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x0400;
        const STILL_ACTIVE: u32 = 259;
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false; // 进程不存在或无权限 → 视为已退出
            }
            let mut exit_code: u32 = 0;
            GetExitCodeProcess(handle, &mut exit_code);
            // CloseHandle — 直接 FFI 声明避免额外 feature 依赖
            extern "system" { fn CloseHandle(h: *mut std::ffi::c_void); }
            CloseHandle(handle);
            exit_code == STILL_ACTIVE
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
}

/// 强杀 PID（无日志输出兜底）
fn force_kill_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::kill(pid as i32, libc::SIGKILL); }
    }
}

/// 通过原始 TCP 发送 HTTP POST /api/shutdown（无 reqwest 依赖）
fn http_post_shutdown(port: u16) {
    use std::io::{Write, Read};
    let addr = format!("127.0.0.1:{}", port);
    if let Ok(addr) = addr.parse() {
        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &addr,
            std::time::Duration::from_secs(2),
        ) {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
            let request = format!(
                "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                port
            );
            let _ = stream.write_all(request.as_bytes());
            let _ = stream.read(&mut [0; 256]); // 读响应（忽略内容）
        }
    }
}

/// 优雅关闭 eleved 子进程
///
/// 1. 尝试 HTTP POST /api/shutdown（超时 2s）
/// 2. 等待 PID 退出（最多 3s，每 200ms 检查）
/// 3. 超时后 taskkill /F 强杀兜底
fn graceful_shutdown_eleved(state: &TauriAppState) {
    if state.shutting_down.swap(true, Ordering::SeqCst) {
        return; // 已经在关闭中
    }

    let pid = state.eleved_pid.lock()
        .ok()
        .and_then(|g| *g);
    let Some(pid) = pid else { return; };

    eprintln!("[TAURI] 优雅关闭 eleved (PID={})...", pid);

    // Step 1: 尝试 HTTP /api/shutdown
    let port = state.gateway_port.load(Ordering::SeqCst);
    if port > 0 {
        eprintln!("[TAURI] 发送 HTTP POST /api/shutdown (port={})...", port);
        http_post_shutdown(port);
    }

    // Step 2: 等待进程退出（最多 3 秒，每 200ms 检查）
    // 正常情况下 eleved 在收到 shutdown 后 500ms 内退出
    // 3s 足够覆盖 axum graceful shutdown + SQLite 关闭，超出则强杀
    for i in 0..15 {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if !is_pid_alive(pid) {
            eprintln!("[TAURI] eleved 已优雅退出 (等待约 {}ms)", (i + 1) * 200);
            return;
        }
    }

    // Step 3: 超时，强杀兜底
    eprintln!("[TAURI] 优雅关闭超时 (3s)，强制终止...");
    force_kill_pid(pid);

    // 确认已死
    std::thread::sleep(std::time::Duration::from_millis(200));
    if !is_pid_alive(pid) {
        eprintln!("[TAURI] eleved 已强制终止");
    } else {
        eprintln!("[TAURI] 警告：eleved 进程仍存活 (PID={})", pid);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP & EXIT
// ═══════════════════════════════════════════════════════════════════════════

fn cleanup_and_exit(app: &tauri::AppHandle) {
    // 1. 立即隐藏所有窗口 — 用户点击关闭后窗口瞬间消失，不卡顿
    //    必须在等 eleved 退出之前，否则窗口冻住 3s 很傻
    for win in app.webview_windows().values() {
        let _ = win.hide();
    }

    // 2. 关闭所有子窗口（看板等），防止残留
    for win in app.webview_windows().values() {
        if win.label() != "main" {
            let _ = win.close();
        }
    }

    // 3. 优雅关闭 eleved（阻塞等待，确保 SQLite 连接正常关闭）
    //    此时窗口已隐藏，用户看不到任何卡顿
    if let Some(state) = app.try_state::<TauriAppState>() {
        graceful_shutdown_eleved(&state);
    }

    // 4. 清理 gateway_state.json，防止下次启动读到残留端口
    let eleve_home = resolve_eleve_home();
    let state_file = eleve_home.join("runtime").join("gateway_state.json");
    let _ = std::fs::remove_file(&state_file);

    // 5. 最后退出 Tauri（此时 eleved 已死，文件句柄已释放）
    app.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLICATION ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_gateway_port,
            get_auto_start,
            set_auto_start,
            // 🔴 W-1 死代码清除（2026-08-05）：resolve_media 命令全库零调用——
            // MEDIA 处理唯一消费链 src/utils/media.ts → WS media.resolve
            // （后端 misc_service 权威实现），此命令为早期 Tauri 本地处理遗留
            create_deepseek_webview,
            mark_restarting,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("Eleve Chat").ok();

            // Window icon
            let icon_bytes = include_bytes!("../icons/128x128.png");
            if let Ok(img) = image::load_from_memory(icon_bytes) {
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                let icon = tauri::image::Image::new_owned(rgba.into_vec(), w, h);
                let _ = window.set_icon(icon);
            }

            // System tray
            let show_item = MenuItem::with_id(app, "show", "\u{663e}\u{793a}\u{7a97}\u{53e3}", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "\u{9000}\u{51fa}", true, None::<&str>)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon_bytes = include_bytes!("../icons/32x32.png");
            let tray_img = image::load_from_memory(tray_icon_bytes).expect("Failed to load tray icon");
            let tray_rgba = tray_img.to_rgba8();
            let (tw, th) = tray_rgba.dimensions();
            let tray_icon = tauri::image::Image::new_owned(tray_rgba.into_vec(), tw, th);

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Eleve Chat")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => { cleanup_and_exit(app); }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ════════════════════════════════════════════════════════════
            // BOOTSTRAP: 启动 eleved 子进程 + 端口发现
            // ════════════════════════════════════════════════════════════

            let eleve_home = resolve_eleve_home();
            eprintln!("[TAURI] eleve_home = {:?}", eleve_home);

            // 确保目录结构存在
            std::fs::create_dir_all(&eleve_home).ok();
            // 🔴 对齐后端 bootstrap/mod.rs 目录布局（2026-08-05 审计修复）：
            // default 归位（2026-08-02）后目录拆两层——
            //   全局根（ensure_global_directories）: logs/pairing/runtime/app-data/cache/*/boards
            //   profiles/default/（ensure_profile_directories）: cron/sessions/skills/memories/hooks/credentials/mcp-tokens
            // 旧实现在根下创建 per-profile 目录 → 幽灵空目录（后端从不读写它们）。
            let global_subdirs = [
                "logs", "pairing", "runtime", "app-data", "boards",
                "cache",
                "cache/images", "cache/audio", "cache/terminal", "cache/sandbox",
                "cache/vision", "cache/voice", "cache/results",
            ];
            for sub in &global_subdirs { std::fs::create_dir_all(eleve_home.join(sub)).ok(); }
            let profile_subdirs = [
                "cron", "sessions", "skills", "memories", "hooks", "credentials", "mcp-tokens",
            ];
            for sub in &profile_subdirs {
                std::fs::create_dir_all(eleve_home.join("profiles").join("default").join(sub)).ok();
            }

            // 初始化 tracing — 对齐 CLI main.rs 的日志基础设施
            // Tauri 壳的日志写到 logs/tauri.log，与 eleved 子进程的 logs/eleved.log 分离
            {
                use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
                let log_dir = eleve_home.join("logs");
                let log_file = log_dir.join("tauri.log");
                if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_file) {
                    let _ = tracing_subscriber::registry()
                        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
                        .with(tracing_subscriber::fmt::layer().with_writer(std::sync::Mutex::new(file)).with_ansi(false))
                        .with(tracing_subscriber::EnvFilter::from_default_env())
                        .try_init();
                } else {
                    let _ = tracing_subscriber::fmt::try_init();
                }
                tracing::info!("[TAURI] Tracing initialized, log file: {:?}", log_file);
            }

            // 🔑 关键：删除旧 gateway_state.json，防止端口发现读到上次运行的残留端口
            let stale_state = eleve_home.join("runtime").join("gateway_state.json");
            if stale_state.exists() {
                if let Err(e) = std::fs::remove_file(&stale_state) {
                    eprintln!("[TAURI] Warning: failed to delete stale gateway_state.json: {}", e);
                } else {
                    eprintln!("[TAURI] Deleted stale gateway_state.json (will be recreated by new eleved)");
                }
            }

            // 启动 eleved 子进程
            let child = start_eleved_process(&eleve_home)
                .map_err(|e| {
                    eprintln!("[TAURI] FATAL: {}", e);
                    e
                })?;
            let pid = child.id();

            // 注册 Tauri managed state
            let tauri_state = TauriAppState {
                gateway_port: Arc::new(AtomicU16::new(0)),
                eleved_pid: std::sync::Mutex::new(Some(pid)),
                shutting_down: AtomicBool::new(false),
                restarting: AtomicBool::new(false),
            };
            app.manage(tauri_state);

            // 在后台线程中轮询端口发现（不阻塞 Tauri setup）
            let port_atomic = app.state::<TauriAppState>().gateway_port.clone();
            let home_for_discovery = eleve_home.clone();
            std::thread::spawn(move || {
                match discover_gateway_port(&home_for_discovery) {
                    Ok(port) => {
                        port_atomic.store(port, Ordering::SeqCst);
                        eprintln!("[TAURI] Gateway 就绪: http://127.0.0.1:{}", port);
                    }
                    Err(e) => {
                        eprintln!("[TAURI] 端口发现失败: {}", e);
                    }
                }
            });

            // 后台线程：监控 eleved 子进程生命周期
            // - shutting_down → 正常关闭（用户退出应用），不重启
            // - restarting → 用户主动重启，自动拉起新 eleved（托管重启，新进程成为 Tauri child，关窗可杀）
            // - 其它 → 意外退出，仅告警
            let app_handle = app.handle().clone();
            spawn_eleved_monitor(child, app_handle, eleve_home);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let label = window.label().to_string();
                // 只有主窗口关闭才退出应用，其他窗口（如看板）只关闭窗口本身
                if label == "main" {
                    let app = window.app_handle().clone();
                    // 同步执行关闭流程（阻塞直到 eleved 完全退出）
                    // 不能用 std::thread::spawn — app.exit(0) 会抢在 cleanup 之前
                    cleanup_and_exit(&app);
                }
                // 非主窗口（kanban 等）：默认行为即关闭该窗口，不退出应用
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
