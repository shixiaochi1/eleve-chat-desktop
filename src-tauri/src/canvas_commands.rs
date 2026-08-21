//! 画布插件化 S5（2026-08-18）：ELEVE 壳内的画布能力
//!
//! 画布 = ELEVE 插件的浏览器半，运行在本壳的 WebviewWindow 里
//! （加载 gateway `/plugins/canvas/*` 资产）。本模块提供：
//!
//! 1. `toggle_canvas_window` — 画布窗口单例管理（toggle 语义，仿 kanban）。
//!    🔴 单例硬约束：canvasStore 是唯一真相源，多窗口 = 多真相源（红线）
//! 2. 画布状态持久化（save/load_state_to_file，从画布 src-tauri 搬入，
//!    命令名不变，前端 invoke 零改动）
//! 3. 图片处理命令（image_compress/image_crop_grid/image_merge/
//!    drawing_composite/imgbb_upload，从画布 src-tauri 搬入——
//!    imgbb 是 MXAPI 平台要求，老大禁删）
//!
//! 错误类型：画布 image_ops 原用 AppError::Internal(String) 单一变体，
//! 搬入后直接用 Result<T, String>（tauri command 等价序列化，零行为变化）。

use base64::{engine::general_purpose, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::{DynamicImage, GenericImageView, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::Manager; // get_webview_window / path() 等 AppHandle 扩展方法

// ─── 1. 画布窗口 ─────────────────────────────────────────────────────────────

/// 画布窗口标签（全局单例）
const CANVAS_LABEL: &str = "canvas";

/// 确保画布窗口可见（幂等打开）：不存在→建；hidden/最小化→恢复显示+聚焦。
/// shell.open_canvas 帧的落地语义（打开意图，非 toggle）。
async fn ensure_canvas_visible(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::TauriAppState>,
) -> Result<String, String> {
    tracing::warn!("[CANVAS] ensure_canvas_visible entered");
    if let Some(w) = app.get_webview_window(CANVAS_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        tracing::warn!("[CANVAS] ensure: window exists → show+focus");
        return Ok("shown".to_string());
    }

    // 不存在 → 新建。gateway 端口必须就绪（画布资产由 gateway 提供，同源装载）
    let port = crate::resolve_gateway_port_cached(app, state).await?;
    tracing::warn!("[CANVAS] resolved gateway port={}", port);
    let url = format!("http://127.0.0.1:{}/plugins/canvas/index.html", port);

    // 与主窗口同 additional_browser_args，防 0x8007139F（kanban 同款教训）
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        CANVAS_LABEL,
        tauri::WebviewUrl::External(url.parse().map_err(|e| format!("canvas url invalid: {}", e))?),
    )
    .title("画布 — Eleve")
    .inner_size(1280.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .center()
    .resizable(true)
    .decorations(false)
    .visible(false)
    .additional_browser_args(crate::ELEVE_WEBVIEW_ARGS);

    let w = builder.build().map_err(|e| {
        tracing::error!("[CANVAS] window create FAILED: {}", e);
        format!("canvas window create failed: {}", e)
    })?;
    let _ = w.show();
    let _ = w.set_focus();
    tracing::warn!("[CANVAS] window created + shown (port {})", port);
    Ok("created-shown".to_string())
}

/// 打开画布窗口（幂等）——shell.open_canvas 帧 / canvas_open 工具的落地命令。
#[tauri::command]
pub async fn open_canvas_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TauriAppState>,
) -> Result<String, String> {
    tracing::warn!("[CANVAS] open_canvas_window invoked");
    ensure_canvas_visible(&app, &state).await
}

/// 打开/切换画布窗口（toggle 语义，单例）——`shell.toggle_canvas` 帧的落地命令
/// （2026-08-19 按钮切换需求：壳画布按钮 → canvas.toggle RPC → 本命令按
/// 可见性 隐藏/显示，绝不新建第二个窗口；窗口不存在才 ensure 新建）。
///
/// URL = gateway 插件资产：`http://127.0.0.1:<port>/plugins/canvas/index.html`
/// （画布插件化 S2 静态路由）。端口来自 TauriAppState.gateway_port
/// （eleved 监控线程维护；0 = gateway 未就绪 → 报错，不建窗）。
///
/// 返回值：`"shown"` / `"hidden"` / `"created-shown"`
#[tauri::command]
pub async fn toggle_canvas_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TauriAppState>,
) -> Result<String, String> {
    // 已存在 → toggle（可见→隐藏；隐藏/最小化→显示；单例硬约束，不新开）
    if let Some(w) = app.get_webview_window(CANVAS_LABEL) {
        let visible = w.is_visible().unwrap_or(false);
        if visible {
            let _ = w.hide();
            eprintln!("[TAURI] canvas toggle: hide");
            return Ok("hidden".to_string());
        }
    }
    ensure_canvas_visible(&app, &state).await
}

/// 关闭画布窗口（canvas 插件 unload 时经 shell.* 帧触发，幂等）
#[tauri::command]
pub fn close_canvas_window(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(w) = app.get_webview_window(CANVAS_LABEL) {
        let _ = w.destroy();
        eprintln!("[TAURI] canvas window closed");
        Ok("closed".to_string())
    } else {
        Ok("absent".to_string())
    }
}

// ─── 2. 画布状态持久化（搬入，命令名不变）─────────────────────────────────

/// 同步保存状态到文件（画布关窗前调用，确保数据落盘）
#[tauri::command]
pub fn save_state_to_file(app: tauri::AppHandle, key: String, data: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let state_dir = app_data_dir.join("canvas-state");
    std::fs::create_dir_all(&state_dir)
        .map_err(|e| format!("Failed to create state dir: {}", e))?;

    let file_path = state_dir.join(format!("{}.json", key));
    std::fs::write(&file_path, &data)
        .map_err(|e| format!("Failed to write state file: {}", e))?;

    eprintln!(
        "[TAURI] canvas state saved: {:?} ({} bytes)",
        file_path,
        data.len()
    );
    Ok(())
}

/// 从文件读取状态（画布启动时调用）
#[tauri::command]
pub fn load_state_from_file(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let file_path = app_data_dir.join("canvas-state").join(format!("{}.json", key));

    if file_path.exists() {
        let data = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read state file: {}", e))?;
        eprintln!(
            "[TAURI] canvas state loaded: {:?} ({} bytes)",
            file_path,
            data.len()
        );
        Ok(Some(data))
    } else {
        eprintln!("[TAURI] canvas state not found: {:?}", file_path);
        Ok(None)
    }
}

// ─── 3. 图片处理命令（从画布 src-tauri image_ops.rs 搬入，行为等价）──────

/// 图片输出格式
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Png,
    Jpeg,
    Webp,
}

impl Default for OutputFormat {
    fn default() -> Self {
        Self::Png
    }
}

impl OutputFormat {
    pub fn mime_type(&self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

fn load_from_data_url(data_url: &str) -> Result<DynamicImage, String> {
    let parts: Vec<&str> = data_url.splitn(2, ',').collect();
    if parts.len() != 2 {
        return Err("无效的 Data URL 格式".into());
    }
    if !parts[0].contains(";base64") {
        return Err("Data URL 不是 base64 编码".into());
    }
    let bytes = general_purpose::STANDARD
        .decode(parts[1])
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    image::load_from_memory(&bytes).map_err(|e| format!("图片加载失败: {}", e))
}

fn load_from_bytes(bytes: &[u8]) -> Result<DynamicImage, String> {
    image::load_from_memory(bytes).map_err(|e| format!("图片加载失败: {}", e))
}

fn encode_to_data_url(img: &DynamicImage, format: OutputFormat, quality: u8) -> Result<String, String> {
    let mut buffer = Cursor::new(Vec::new());
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    match format {
        OutputFormat::Png => {
            let encoder = PngEncoder::new(&mut buffer);
            encoder
                .write_image(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
                .map_err(|e| format!("PNG 编码失败: {}", e))?;
        }
        OutputFormat::Jpeg => {
            let rgb = img.to_rgb8();
            let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
            encoder
                .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("JPEG 编码失败: {}", e))?;
        }
        OutputFormat::Webp => {
            let encoder = WebPEncoder::new_lossless(&mut buffer);
            encoder
                .write_image(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
                .map_err(|e| format!("WebP 编码失败: {}", e))?;
        }
    }

    let bytes = buffer.into_inner();
    Ok(format!(
        "data:{};base64,{}",
        format.mime_type(),
        general_purpose::STANDARD.encode(&bytes)
    ))
}

/// 异步加载图片（Data URL / HTTP URL / 本地路径，三源自动识别）
async fn load_image_async(source: &str) -> Result<DynamicImage, String> {
    if source.starts_with("data:image/") {
        let source = source.to_string();
        tokio::task::spawn_blocking(move || load_from_data_url(&source))
            .await
            .map_err(|e| format!("任务执行失败: {}", e))?
    } else if source.starts_with("http://") || source.starts_with("https://") {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .no_proxy()
            .build()
            .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

        let resp = client
            .get(source)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Accept", "image/*,*/*;q=0.8")
            .send()
            .await
            .map_err(|e| format!("HTTP 请求失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP 请求失败: {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取响应体失败: {}", e))?;
        let bytes_vec = bytes.to_vec();
        tokio::task::spawn_blocking(move || load_from_bytes(&bytes_vec))
            .await
            .map_err(|e| format!("任务执行失败: {}", e))?
    } else {
        let source = source.to_string();
        tokio::task::spawn_blocking(move || {
            let path = std::path::Path::new(&source);
            if !path.exists() {
                return Err(format!("文件不存在: {}", source));
            }
            image::open(path).map_err(|e| format!("图片加载失败: {}", e))
        })
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
    }
}

/// 图片压缩（等比缩放到 max_dim 以内 + 质量调整）
#[tauri::command]
pub async fn image_compress(
    image_data: String,
    max_dim: u32,
    quality: u8,
    output_format: Option<OutputFormat>,
) -> Result<String, String> {
    let format = output_format.unwrap_or(OutputFormat::Jpeg);
    let img = load_image_async(&image_data).await?;

    let (orig_w, orig_h) = img.dimensions();
    let (new_w, new_h) = if orig_w > max_dim || orig_h > max_dim {
        if orig_w > orig_h {
            let h = (orig_h as f64 * max_dim as f64 / orig_w as f64) as u32;
            (max_dim, h)
        } else {
            let w = (orig_w as f64 * max_dim as f64 / orig_h as f64) as u32;
            (w, max_dim)
        }
    } else {
        (orig_w, orig_h)
    };

    let resized = if (new_w, new_h) != (orig_w, orig_h) {
        img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    encode_to_data_url(&resized, format, quality)
}

/// ImgBB 图床上传（MXAPI 平台要求，老大禁删——画布 MXAPI 路径参考图
/// 需国际 CDN URL；ELEVE 路径原生 data URI 不经此处）
#[tauri::command]
pub async fn imgbb_upload(
    image_data: String,
    api_key: String,
    expiration: Option<u32>,
) -> Result<String, String> {
    let expiration = expiration.unwrap_or(600);

    let img = load_image_async(&image_data).await?;

    // 编码为 JPEG（减小体积）
    let mut buffer = Cursor::new(Vec::new());
    let rgb = img.to_rgb8();
    let (width, height) = rgb.dimensions();
    let encoder = JpegEncoder::new_with_quality(&mut buffer, 85);
    encoder
        .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG 编码失败: {}", e))?;

    let base64_str = general_purpose::STANDARD.encode(buffer.into_inner());

    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::text(base64_str)
        .file_name("image.jpg")
        .mime_str("image/jpeg")
        .map_err(|e| format!("构造 Part 失败: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("key", api_key)
        .text("expiration", expiration.to_string());

    let resp = client
        .post("https://api.imgbb.com/1/upload")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("ImgBB 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let error_text = resp.text().await.unwrap_or_default();
        return Err(format!("ImgBB 上传失败 ({}): {}", status, error_text));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 ImgBB 响应失败: {}", e))?;

    if data["success"].as_bool() == Some(true) {
        if let Some(url) = data["data"]["url"].as_str() {
            return Ok(url.to_string());
        }
    }

    Err(format!(
        "ImgBB 返回异常: {}",
        serde_json::to_string(&data).unwrap_or_default()
    ))
}

/// 图片网格裁切（cols × rows，从左到右从上到下）
#[tauri::command]
pub async fn image_crop_grid(
    image_data: String,
    cols: u32,
    rows: u32,
) -> Result<Vec<String>, String> {
    if cols == 0 || rows == 0 {
        return Err("列数和行数必须大于 0".into());
    }

    let img = load_image_async(&image_data).await?;
    let (img_w, img_h) = img.dimensions();

    let cell_w = img_w / cols;
    let cell_h = img_h / rows;

    if cell_w == 0 || cell_h == 0 {
        return Err(format!(
            "图片太小 ({}x{})，无法切分为 {}x{} 网格",
            img_w, img_h, cols, rows
        ));
    }

    let mut results = Vec::with_capacity((cols * rows) as usize);
    for r in 0..rows {
        for c in 0..cols {
            let cropped = img.crop_imm(c * cell_w, r * cell_h, cell_w, cell_h);
            results.push(encode_to_data_url(&cropped, OutputFormat::Png, 100)?);
        }
    }
    Ok(results)
}

/// 多图合并布局
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MergeLayout {
    Horizontal,
    Vertical,
    Grid,
}

impl MergeLayout {
    fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "horizontal" => Ok(Self::Horizontal),
            "vertical" => Ok(Self::Vertical),
            "grid" => Ok(Self::Grid),
            _ => Err(format!("无效的布局方式: {}", s)),
        }
    }
}

fn parse_color(s: String) -> Option<[u8; 3]> {
    let s = s.trim().trim_start_matches('#');
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some([r, g, b])
    } else {
        None
    }
}

fn calc_horizontal_layout(
    images: &[image::RgbaImage],
    gap: u32,
) -> (u32, u32, Vec<(i64, i64, u32, u32)>) {
    let target_h = images.iter().map(|img| img.height()).max().unwrap_or(0);
    let mut ops = Vec::new();
    let mut cursor_x = 0;
    for (i, img) in images.iter().enumerate() {
        let scale = target_h as f64 / img.height() as f64;
        let w = (img.width() as f64 * scale) as u32;
        ops.push((cursor_x as i64, 0, w, target_h));
        cursor_x += w;
        if i < images.len() - 1 {
            cursor_x += gap;
        }
    }
    (cursor_x, target_h, ops)
}

fn calc_vertical_layout(
    images: &[image::RgbaImage],
    gap: u32,
) -> (u32, u32, Vec<(i64, i64, u32, u32)>) {
    let target_w = images.iter().map(|img| img.width()).max().unwrap_or(0);
    let mut ops = Vec::new();
    let mut cursor_y = 0;
    for (i, img) in images.iter().enumerate() {
        let scale = target_w as f64 / img.width() as f64;
        let h = (img.height() as f64 * scale) as u32;
        ops.push((0, cursor_y as i64, target_w, h));
        cursor_y += h;
        if i < images.len() - 1 {
            cursor_y += gap;
        }
    }
    (target_w, cursor_y, ops)
}

fn calc_grid_layout(
    images: &[image::RgbaImage],
    gap: u32,
) -> (u32, u32, Vec<(i64, i64, u32, u32)>) {
    let n = images.len();
    let cols = (n as f64).sqrt().ceil() as u32;
    let rows = ((n as f64) / (cols as f64)).ceil() as u32;
    let avg_w = images.iter().map(|img| img.width()).sum::<u32>() / n as u32;
    let avg_h = images.iter().map(|img| img.height()).sum::<u32>() / n as u32;
    let cell_w = avg_w.max(1);
    let cell_h = avg_h.max(1);

    let mut ops = Vec::new();
    for (i, _img) in images.iter().enumerate() {
        let r = (i as u32) / cols;
        let c = (i as u32) % cols;
        ops.push(((c * (cell_w + gap)) as i64, (r * (cell_h + gap)) as i64, cell_w, cell_h));
    }

    let canvas_w = cols * cell_w + (cols - 1) * gap;
    let canvas_h = rows * cell_h + (rows - 1) * gap;
    (canvas_w, canvas_h, ops)
}

/// 多图合并（横向/纵向/宫格）
#[tauri::command]
pub async fn image_merge(
    images: Vec<String>,
    layout: String,
    gap: u32,
    background: Option<String>,
) -> Result<String, String> {
    if images.len() < 2 {
        return Err("至少需要 2 张图才能合并".into());
    }

    let merge_layout = MergeLayout::from_str(&layout)?;

    let mut loaded_images = Vec::with_capacity(images.len());
    for (i, src) in images.iter().enumerate() {
        let img = load_image_async(src)
            .await
            .map_err(|e| format!("加载第 {} 张图片失败: {}", i + 1, e))?;
        loaded_images.push(img.to_rgba8());
    }

    let bg_color = background.and_then(parse_color);

    let (canvas_w, canvas_h, draw_ops) = match merge_layout {
        MergeLayout::Horizontal => calc_horizontal_layout(&loaded_images, gap),
        MergeLayout::Vertical => calc_vertical_layout(&loaded_images, gap),
        MergeLayout::Grid => calc_grid_layout(&loaded_images, gap),
    };

    let mut canvas = image::RgbaImage::new(canvas_w, canvas_h);
    if let Some(bg) = bg_color {
        for pixel in canvas.pixels_mut() {
            *pixel = image::Rgba([bg[0], bg[1], bg[2], 255]);
        }
    }

    for (img, (x, y, w, h)) in loaded_images.iter().zip(draw_ops.iter()) {
        let resized = image::imageops::resize(img, *w, *h, image::imageops::FilterType::Lanczos3);
        image::imageops::overlay(&mut canvas, &resized, *x, *y);
    }

    let dynamic = DynamicImage::ImageRgba8(canvas);
    encode_to_data_url(&dynamic, OutputFormat::Png, 100)
}

/// 画板合成（底图 + 绘制层叠加）
#[tauri::command]
pub async fn drawing_composite(
    bg_image: String,
    draw_layer: String,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let mut canvas = image::RgbaImage::new(width, height);

    if !bg_image.is_empty() {
        match load_image_async(&bg_image).await {
            Ok(bg) => {
                let bg_rgba = bg.to_rgba8();
                let resized_bg = image::imageops::resize(
                    &bg_rgba,
                    width,
                    height,
                    image::imageops::FilterType::Lanczos3,
                );
                image::imageops::overlay(&mut canvas, &resized_bg, 0, 0);
            }
            Err(e) => {
                // 底图加载失败不阻断，继续绘制层
                eprintln!("[drawing_composite] 底图加载失败: {}", e);
            }
        }
    }

    let draw = load_image_async(&draw_layer)
        .await
        .map_err(|e| format!("绘制层加载失败: {}", e))?;
    let draw_rgba = draw.to_rgba8();
    let resized_draw = image::imageops::resize(
        &draw_rgba,
        width,
        height,
        image::imageops::FilterType::Lanczos3,
    );
    image::imageops::overlay(&mut canvas, &resized_draw, 0, 0);

    let dynamic = DynamicImage::ImageRgba8(canvas);
    encode_to_data_url(&dynamic, OutputFormat::Png, 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_format_mime() {
        assert_eq!(OutputFormat::Png.mime_type(), "image/png");
        assert_eq!(OutputFormat::Jpeg.mime_type(), "image/jpeg");
        assert_eq!(OutputFormat::Webp.mime_type(), "image/webp");
    }

    #[test]
    fn encode_decode_roundtrip() {
        let img = DynamicImage::new_rgb8(100, 100);
        let data_url = encode_to_data_url(&img, OutputFormat::Png, 100).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
        let decoded = load_from_data_url(&data_url).unwrap();
        assert_eq!(decoded.dimensions(), (100, 100));
    }
}
