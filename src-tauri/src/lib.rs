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
            commands::minimax::generate_presentation,
            commands::minimax::generate_presentation_design,
            commands::minimax::save_minimax_api_key,
            commands::minimax::delete_minimax_api_key,
            commands::minimax::minimax_api_key_configured,
            commands::minimax::test_minimax_connection,
            commands::project_file::save_project,
            commands::project_file::open_project,
            commands::project_file::save_recovery,
            commands::project_file::load_recovery,
            commands::project_file::clear_recovery,
            commands::project_file::write_pptx,
            commands::project_file::import_pptx_template,
            commands::project_file::list_pptx_templates,
            commands::project_file::get_pptx_template_preview,
            commands::project_file::analyze_pptx_template
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PPTD");
}
