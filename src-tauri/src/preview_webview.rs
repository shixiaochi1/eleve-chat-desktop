//! Preview 子 Webview 生命周期管理 — create/close/update/navigate/reload/devtools
//! 单一入口（前端只传意图，原生层操作全在 Rust，对齐方案"PreviewWebviewManager"）
//!
//! 架构要点：
//!   - label 由 Rust 生成（preview-<n>，满足 webview label 字符集 a-zA-Z-/:_），
//!     前端持有 label ↔ tab.id 映射，不自行构造
//!   - 受管 label 集合是 console 推送注册表（preview_console.rs）的唯一数据源，
//!     创建注册 / 关闭注销，杜绝远程页面伪造 label 注入
//!   - Webview 句柄不跨命令缓存：每次操作从 window.webviews() 实时查找
//!     （避免句柄失效；查找开销 O(webview 数)，预览场景 ≤ 数 个，可忽略）
//!   - console 捕获注入脚本 include_str! 编译期嵌入（对齐 deepseek-inject.js 模式），
//!     label 硬编码进脚本 —— 远程页面拿到的就是自己的 label，无伪造空间
//!
//! 生命周期语义：
//!   - create：注册 label + 建 webview（空白 URL 不创建，返回空 label 由前端跳过）
//!   - navigate：切 URL 前清空该 label 缓冲（新页面新会话，对齐方案）
//!   - close：先注销/清缓冲，再销毁 webview

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::preview_console::PreviewConsoleState;

/// managed state：受管 preview webview label 集合 + 生成器计数
#[derive(Default)]
pub struct PreviewWebviewManager {
    labels: Mutex<HashSet<String>>,
    counter: AtomicU64,
}

impl PreviewWebviewManager {
    fn next_label(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::SeqCst);
        format!("preview-{}", n)
    }

    fn find(&self, window: &tauri::Window, label: &str) -> Option<tauri::Webview> {
        window.webviews().into_iter().find(|w| w.label() == label)
    }
}

/// 创建子 webview（console 捕获注入脚本 + 定位 + 加载状态事件）；返回生成的 label
#[tauri::command]
pub async fn preview_webview_create(
    app: tauri::AppHandle,
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    console: tauri::State<'_, PreviewConsoleState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    use tauri::{Emitter, LogicalPosition, LogicalSize};

    // URL 协议白名单（对齐前端 isSafePreviewUrl：仅 http/https）
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("preview_webview_create: invalid url: {}", e))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("preview_webview_create: only http/https allowed".into());
    }

    eprintln!(
        "[PREVIEW] create called: url={} rect=({}, {}, {}, {})",
        url, x, y, width, height
    );

    let label = manager.next_label();

    // 注入脚本：label 硬编码（远程页面无伪造空间）
    let capture = include_str!("../inject/preview-console-capture.js");
    let init_script = capture.replace("__PREVIEW_CONSOLE_LABEL__", &label);

    // 加载状态事件（对齐 Hermes did-start-loading/did-stop-loading）：
    // Started → 前端清错误态；Finished → 前端探测服务器可达性（失败导航也会触发）
    let emit_label = label.clone();
    let builder = tauri::webview::WebviewBuilder::new(
        label.clone(),
        tauri::WebviewUrl::External(parsed),
    )
    .initialization_script(&init_script)
    // 🔴 必须与主窗口同 additional_browser_args（同一 user data folder 内 args 必须一致）
    // 缺此 → WebView2 创建挂起/失败（看板 0x8007139F 同款，2026-08-13 修复）
    .additional_browser_args(crate::ELEVE_WEBVIEW_ARGS)
    .on_page_load(move |_wv, payload| {
        use tauri::webview::PageLoadEvent;
        let state = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        eprintln!("[PREVIEW] load: label={} state={} url={}", emit_label, state, payload.url());
        let _ = app.emit(
            "preview-load-state",
            serde_json::json!({ "label": emit_label, "state": state, "url": payload.url() }),
        );
    })
    .disable_drag_drop_handler();

    let add_result = window.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    );
    match add_result {
        Ok(_) => {
            eprintln!("[PREVIEW] created: label={}", label);
        }
        Err(e) => {
            eprintln!("[PREVIEW] add_child FAILED: {}", e);
            return Err(format!("preview_webview_create: add_child failed: {}", e));
        }
    }

    manager.labels.lock().unwrap().insert(label.clone());
    console.register_label(&label);
    Ok(label)
}

/// 关闭并销毁子 webview（先注销 console 注册/清缓冲，再销毁）
#[tauri::command]
pub async fn preview_webview_close(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    console: tauri::State<'_, PreviewConsoleState>,
    label: String,
) -> Result<(), String> {
    manager.labels.lock().unwrap().remove(&label);
    console.remove_label(&label);
    if let Some(wv) = manager.find(&window, &label) {
        eprintln!("[PREVIEW] close: label={}", label);
        wv.close().map_err(|e| format!("preview_webview_close: {}", e))?;
    } else {
        eprintln!("[PREVIEW] close: label={} not found (skip)", label);
    }
    Ok(())
}

/// 读取子 webview 页面文本（🔴 2026-08-20 对齐 Hermes read_preview / preview-reader.ts）：
/// wry evaluate_script 同步返回 `{title, text}`（text = body.innerText，上限 200K 字符）。
/// 供前端 preview.read.request 处理：read_preview 工具 → WS 桥 → 前端 invoke 本命令。
#[tauri::command]
pub fn preview_webview_read_text(window: tauri::Window, label: String) -> Result<String, String> {
    let webview = window
        .webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| "preview_webview_read_text: webview not found".to_string())?;
    let js = r#"(function(){try{var d=document;return JSON.stringify({title:d.title,text:d.body?d.body.innerText.slice(0,200000):''})}catch(e){return JSON.stringify({title:'',text:'',error:String(e)})}})()"#;
    webview
        .with_webview(|wv| wv.evaluate_script(js).map_err(|e| e.to_string()))
        .map_err(|e| format!("preview_webview_read_text: {}", e))
}

/// 位置/大小同步（前端 rAF 节流后调用，position+size 合并传）
#[tauri::command]
pub async fn preview_webview_update(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};
    let wv = manager
        .find(&window, &label)
        .ok_or_else(|| "preview_webview_update: webview not found".to_string())?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("preview_webview_update: {}", e))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("preview_webview_update: {}", e))?;
    Ok(())
}

/// 导航到新 URL（先清缓冲：新页面新会话）
#[tauri::command]
pub async fn preview_webview_navigate(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    console: tauri::State<'_, PreviewConsoleState>,
    label: String,
    url: String,
) -> Result<(), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("preview_webview_navigate: invalid url: {}", e))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("preview_webview_navigate: only http/https allowed".into());
    }
    let wv = manager
        .find(&window, &label)
        .ok_or_else(|| "preview_webview_navigate: webview not found".to_string())?;
    console.clear_label(&label);
    eprintln!("[PREVIEW] navigate: label={} url={}", label, url);
    wv.navigate(parsed)
        .map_err(|e| format!("preview_webview_navigate: {}", e))?;
    Ok(())
}

/// 重新加载（文件变更自动刷新 / 重启成功 / 手动加载）
#[tauri::command]
pub async fn preview_webview_reload(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    label: String,
) -> Result<(), String> {
    let wv = manager
        .find(&window, &label)
        .ok_or_else(|| "preview_webview_reload: webview not found".to_string())?;
    eprintln!("[PREVIEW] reload: label={}", label);
    wv.reload().map_err(|e| format!("preview_webview_reload: {}", e))?;
    Ok(())
}

/// 显示/隐藏子 webview（错误覆盖层需要盖住 webview 时用——子 webview 是原生
/// HWND 永远在 DOM 之上，z-index 无效，只能 hide 让 DOM 覆盖层可见）
#[tauri::command]
pub async fn preview_webview_visible(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    label: String,
    visible: bool,
) -> Result<(), String> {
    let wv = manager
        .find(&window, &label)
        .ok_or_else(|| "preview_webview_visible: webview not found".to_string())?;
    eprintln!("[PREVIEW] visible: label={} visible={}", label, visible);
    if visible {
        wv.show().map_err(|e| format!("preview_webview_visible: {}", e))?;
    } else {
        wv.hide().map_err(|e| format!("preview_webview_visible: {}", e))?;
    }
    Ok(())
}

/// 开关开发者工具（对齐 Hermes devtoolsOpen 前端状态驱动；open 参数由前端 state 决定）
///
/// ⚠️ 平台限制：wry Windows 实现 close_devtools() 是空函数（WebView2 无关闭
/// devtools 窗口的公开 API），is_devtools_open() 硬编码 false——故不能用 Rust 侧
/// 查询做 toggle，由前端维护 devtoolsOpen 状态并显式传 open/close 意图。
#[tauri::command]
pub async fn preview_webview_devtools(
    window: tauri::Window,
    manager: tauri::State<'_, PreviewWebviewManager>,
    label: String,
    open: bool,
) -> Result<bool, String> {
    let wv = manager
        .find(&window, &label)
        .ok_or_else(|| "preview_webview_devtools: webview not found".to_string())?;
    if open {
        eprintln!("[PREVIEW] devtools open: label={}", label);
        wv.open_devtools();
    } else {
        eprintln!("[PREVIEW] devtools close (wry no-op on Windows): label={}", label);
        wv.close_devtools();
    }
    Ok(open)
}
