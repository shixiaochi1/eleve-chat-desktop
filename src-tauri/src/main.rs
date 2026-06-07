// 防止 Windows 上出现控制台黑窗口 (release 模式)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eleve_chat_desktop::run()
}
