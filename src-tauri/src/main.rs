// PPTD is a desktop GUI application. Without the Windows GUI subsystem marker,
// launching the debug executable opens an extra empty console window (or a
// Windows Terminal cmd tab) alongside the Tauri window.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    pptd_lib::run();
}
