//! 剪贴板操作（对齐 Hermes Electron clipboard API）
//!
//! 使用 arboard crate 实现跨平台剪贴板读写。
//! 前端通过 window.eleveDesktop.writeClipboard / readClipboard 调用。

use arboard::Clipboard;

/// 写入文本到剪贴板
#[tauri::command]
pub fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

/// 从剪贴板读取文本
#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}
