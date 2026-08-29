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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::preview_console::PreviewConsoleState;

/// managed state：受管 preview webview label 集合 + 生成器计数
#[derive(Default)]
pub struct PreviewWebviewManager {
    labels: Mutex<HashSet<String>>,
    counter: AtomicU64,
}

/// read_preview 事件回传状态：label → oneshot（页面文本经子 webview
/// `__TAURI_INTERNALS__.invoke('preview_text_received')` 发回后 resolve）。
/// 对齐 Hermes read_preview_tool.py 的阻塞读取语义（同步拿文本）。

// ── 新窗口请求拦截（🔴 2026-08-29 对齐 Hermes 预览面板内嵌语义）──
//
// Hermes 预览面板是 Electron `<webview>`（无 allowpopups）：target=_blank /
// window.open 不会弹独立窗口；主窗口 setWindowOpenHandler 也 deny
// （electron/main.ts L12728-12740：openExternal + deny）——杜绝脱离界面的
// 独立 OS 窗口。
//
// ELEVE 的 WebView2 子 webview 默认放行 NewWindowRequested → 用户点
// target=_blank 链接会弹独立 WebView2 窗口（脱离前端界面）。拦截策略：
// 取消默认新窗口 + 在**同一预览 webview** 内导航——链接始终内置打开；
// 导航后既有的 preview-load-state 事件链（= Hermes did-navigate 同步）
// 自动更新地址栏 / tab 位置状态，前端无感。
//
// 有意偏差（注释如实）：Hermes webview 对 _blank 是静默拒绝（点击无反应）；
// ELEVE 选择在预览内打开——语义更贴"一切都在内置界面"，且复用既有位置
// 同步链路。非 Windows 平台不拦截（wry/WebKitGTK 行为不同，Windows 优先）。
#[cfg(windows)]
fn register_new_window_interceptor(webview: &tauri::Webview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::NewWindowRequestedEventHandler;
    use windows_core::PWSTR;

    let register_result = webview.with_webview(move |platform| unsafe {
        // 回调在 WebView2 UI 线程执行（COM 调用线程要求，同硬刷新范式）
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        // handler 闭包持有自己的 COM 引用（Clone = AddRef）
        let core_handler = core.clone();
        // 闭包签名（webview2-com #[event_callback] 生成）：裸 COM 参数经
        // InvokeArg::convert 包装为 Option——sender 与 args 均可能为 None
        let handler = NewWindowRequestedEventHandler::create(Box::new(
            move |_sender, args: Option<ICoreWebView2NewWindowRequestedEventArgs>| {
                let Some(args) = args else {
                    return Ok(());
                };
                // 先取目标 URL（Uri 是 &mut PWSTR 出参；take_pwstr 转 String
                // 并释放 WebView2 分配的内存），再取消默认独立窗口，最后在
                // 同一预览 webview 内导航（内置在前端界面）
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri_str: String = webview2_com::take_pwstr(uri);
                args.SetHandled(true)?;
                core_handler.Navigate(&windows_core::HSTRING::from(uri_str))?;
                Ok(())
            },
        ));
        // token 不保留：webview 销毁时事件随 COM 对象一起清理
        let mut token = Default::default();
        let _ = core.add_NewWindowRequested(&handler, &mut token);
    });
    if let Err(e) = register_result {
        eprintln!("[PREVIEW] new-window interceptor register failed: {e}");
    }
}
#[derive(Default)]
pub struct PreviewReadState {
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
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

    // URL 协议白名单（🔴 2026-08-29 对齐 Hermes：file HTML 的执行渲染走真浏览器
    // guest——iframe srcDoc 的 about:srcdoc 基准无法解析相对资源（./assets/x.js），
    // file:// webview 可以。Windows 原始路径（C:\x\y.html）parse 会得到伪 scheme
    // "c" → 走 from_file_path 转换为 file:///C:/...）
    let parsed = match url.parse::<tauri::Url>() {
        Ok(u) if matches!(u.scheme(), "http" | "https" | "file") => u,
        _ => tauri::Url::from_file_path(&url)
            .map_err(|_| "preview_webview_create: only http/https/file urls allowed".to_string())?,
    };

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
    // 🔴 标题回调独立克隆（on_page_load 闭包 move app，后续不能再 clone）
    let title_app = app.clone();
    let title_label = label.clone();
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
    // 🔴 2026-08-29 对齐 Hermes noteBrowserPage + page-title-updated：页面标题
    // 变化 → 前端回写 tab 标签（tab 名跟随真实页面而非初始 URL 末段）
    .on_document_title_changed(move |_wv, title| {
        let _ = title_app.emit(
            "preview-page-title",
            serde_json::json!({ "label": title_label, "title": title }),
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

    // 🔴 2026-08-29 新窗口拦截（对齐 Hermes 预览面板内嵌语义——target=_blank /
    // window.open 不弹独立窗口，统一在预览内打开）
    #[cfg(windows)]
    if let Some(wv) = manager.find(&window, &label) {
        register_new_window_interceptor(&wv);
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
/// 子 webview 内 `document.body.innerText`（上限 200K 字符），经
/// `__TAURI_INTERNALS__.invoke('preview_text_received')` 事件回传后阻塞返回。
/// （PlatformWebview 无同步 evaluate_script API——Tauri v2 的 `Webview::eval` 是
///  fire-and-forget，返回值必须走 IPC 回传，这是 wry/WebView2 的架构约束。）
/// 供前端 preview.read.request 处理：read_preview 工具 → WS 桥 → 前端 invoke 本命令。
#[tauri::command]
pub async fn preview_webview_read_text(
    window: tauri::Window,
    state: tauri::State<'_, PreviewReadState>,
    label: String,
) -> Result<String, String> {
    let webview = window
        .webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| "preview_webview_read_text: webview not found".to_string())?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.pending.lock().unwrap().insert(label.clone(), tx);
    let js = format!(
        r#"(function(){{try{{var t=(document.body&&document.body.innerText)||'';var text=t.slice(0,200000);if(typeof window.__TAURI_INTERNALS__!=='undefined'&&window.__TAURI_INTERNALS__.invoke){{window.__TAURI_INTERNALS__.invoke('preview_text_received',{{requestId:{:?},text:text}})}}}}catch(e){{}}}})()"#,
        label
    );
    webview
        .eval(&js)
        .map_err(|e| format!("preview_webview_read_text eval: {}", e))?;
    tokio::time::timeout(std::time::Duration::from_secs(5), rx)
        .await
        .map_err(|_| "preview_webview_read_text: timeout waiting for page text".to_string())?
        .map_err(|_| "preview_webview_read_text: channel closed".to_string())
}

/// 子 webview 页面文本回传（read_preview 内部，不对外暴露）：
/// requestId = webview label（一次一个 pending read，无需自增 id）
#[tauri::command]
pub fn preview_text_received(
    state: tauri::State<'_, PreviewReadState>,
    request_id: String,
    text: String,
) -> Result<(), String> {
    if let Some(tx) = state.pending.lock().unwrap().remove(&request_id) {
        let _ = tx.send(text);
        Ok(())
    } else {
        Err("preview_text_received: no pending read for request_id".into())
    }
}

// ── 硬刷新（🔴 2026-08-29 对齐 Hermes reloadIgnoringCache，preview-pane.tsx:365-369）──
// WebView2 无 ignore-cache 的 reload 变体：清 HTTP 磁盘缓存（ICoreWebView2_11::
// ClearBrowsingData，只清 cache 类资源，不动 cookies/localStorage）→ 完成回调里
// 普通 Reload = 等效硬刷新。profile 级副作用：同一 user data folder 的其它预览
// tab 缓存一并重建（无害，仅下次加载慢一次）。COM handler 范式照抄 wry。

// （handler 不手写：webview2-com 0.38 已提供 #[completed_callback] 生成的
// `ClearBrowsingDataCompletedHandler` 闭包式封装——callback.rs:519，严禁重复造轮子）

/// 硬刷新：清缓存后 reload。非 Windows / WebView2 Runtime 过旧（无 ICoreWebView2_11）
/// 时返回 Err——调用方降级普通 reload（对齐 Hermes「有则用、无则降级」语义）。
#[tauri::command]
pub async fn preview_webview_reload_ignoring_cache(
    window: tauri::Window,
    label: String,
) -> Result<(), String> {
    let webview = window
        .webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| "preview_webview_reload_ignoring_cache: webview not found".to_string())?;

    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::ClearBrowsingDataCompletedHandler;
        use windows_core::Interface;

        webview
            .with_webview(move |platform| {
                // 回调在 WebView2 UI 线程执行（COM 调用线程要求）
                let core_result = unsafe { platform.controller().CoreWebView2() };
                let Ok(core) = core_result else {
                    return;
                };
                // 链路：CoreWebView2 →(_13 Profile)→ ICoreWebView2Profile
                //   →cast Profile2→ ClearBrowsingData（Runtime 1.0.1108+）；
                // 任一 cast 失败 = Runtime 过旧 → 静默返回，调用方按 Err 降级
                let Ok(core13) = core.cast::<ICoreWebView2_13>() else {
                    return;
                };
                let profile_result = unsafe { core13.Profile() };
                let Ok(profile) = profile_result else {
                    return;
                };
                let Ok(profile2) = profile.cast::<ICoreWebView2Profile2>() else {
                    return;
                };
                let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |error| {
                    error?;
                    // 清缓存完成（UI 线程）→ 普通 Reload = 等效硬刷新
                    unsafe {
                        core.Reload()?;
                    }
                    Ok(())
                }));
                let clear_result = unsafe {
                    profile2.ClearBrowsingData(
                        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                        &handler,
                    )
                };
                let _ = clear_result;
            })
            .map_err(|e| format!("preview_webview_reload_ignoring_cache: {e}"))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = label;
        webview.reload().map_err(|e| e.to_string())
    }
}

/// 通用子 webview JS 执行（🔴 2026-08-29 对齐 Hermes preview-act 引擎注入通道）：
/// eval 前端传入的引擎 JS → 页面把 JSON 结果经 preview_text_received 回传 →
/// 阻塞返回字符串。供 preview.act.request 处理（drive_preview 工具 → WS 桥 →
/// 前端 invoke 本命令）。
/// （`Webview::eval` 是 fire-and-forget——wry/WebView2 架构约束，返回值必须走
/// IPC 回传，同 preview_webview_read_text；pending 槽以 label 为 key，与 read
/// 复用 PreviewReadState——桌面端工具调用串行，互踩窗口可忽略）
#[tauri::command]
pub async fn preview_webview_eval_js(
    window: tauri::Window,
    state: tauri::State<'_, PreviewReadState>,
    label: String,
    js: String,
) -> Result<String, String> {
    let webview = window
        .webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| "preview_webview_eval_js: webview not found".to_string())?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.pending.lock().unwrap().insert(label.clone(), tx);
    // 包裹执行：正常 → String(结果)；抛错 → {"error": "..."}（页面侧 try/catch
    // 双保险——这里兜 eval 本身的异常）
    let wrapped = format!(
        r#"(function(){{var RID={:?};function done(t){{if(typeof window.__TAURI_INTERNALS__!=='undefined'&&window.__TAURI_INTERNALS__.invoke){{window.__TAURI_INTERNALS__.invoke('preview_text_received',{{requestId:RID,text:t}})}}}}try{{var r=(function(){{{}}})();done(String(r))}}catch(e){{done(JSON.stringify({{ok:false,error:String(e)}}))}}}})()"#,
        label, js
    );
    webview
        .eval(&wrapped)
        .map_err(|e| format!("preview_webview_eval_js eval: {}", e))?;
    tokio::time::timeout(std::time::Duration::from_secs(15), rx)
        .await
        .map_err(|_| "preview_webview_eval_js: timeout waiting for act result".to_string())?
        .map_err(|_| "preview_webview_eval_js: channel closed".to_string())
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
