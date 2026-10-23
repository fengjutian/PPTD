mod ai;
mod commands;
mod storage;

use tauri::Manager;

#[tauri::command]
fn application_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ai::CancelRegistry::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let database = storage::Database::open(&directory.join("pptd.sqlite3"))
                .map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            application_version,
            commands::storage::load_app_settings,
            commands::storage::save_app_settings,
            commands::storage::load_ai_draft_history,
            commands::storage::upsert_ai_draft_history,
            commands::storage::load_recent_projects,
            commands::storage::upsert_recent_project,
            commands::storage::remove_recent_project,
            commands::ai::generate_presentation,
            commands::ai::generate_presentation_outline,
            commands::ai::generate_presentation_slides_batch,
            commands::ai::generate_slide_briefs,
            commands::ai::generate_presentation_design,
            commands::ai::review_presentation_visuals,
            commands::ai::plan_presentation_repairs,
            commands::ai::polish_presentation_topic,
            commands::ai::cancel_ai_generation,
            commands::ai::end_ai_generation,
            commands::ai::save_ai_api_key,
            commands::ai::delete_ai_api_key,
            commands::ai::ai_api_key_configured,
            commands::ai::test_ai_connection,
            commands::image::generate_presentation_image,
            commands::project_file::save_project,
            commands::project_file::open_project,
            commands::project_file::project_modified_at,
            commands::project_file::read_image_asset,
            commands::project_file::save_recovery,
            commands::project_file::load_recovery,
            commands::project_file::recovery_project_path,
            commands::project_file::clear_recovery,
            commands::project_file::write_pptx,
            commands::project_file::write_pptx_raw,
            commands::project_file::rasterize_pptx_for_review,
            commands::project_file::import_pptx_template,
            commands::project_file::list_pptx_templates,
            commands::project_file::get_pptx_template_preview,
            commands::project_file::render_pptx_template_layouts,
            commands::project_file::analyze_pptx_template
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PPTD");
}
