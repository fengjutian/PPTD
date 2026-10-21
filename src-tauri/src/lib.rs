mod commands;

#[tauri::command]
fn application_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            application_version,
            commands::project_file::save_project,
            commands::project_file::open_project,
            commands::project_file::write_pptx
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PPTD");
}
