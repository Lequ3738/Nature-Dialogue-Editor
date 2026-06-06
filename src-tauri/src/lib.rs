use std::fs;
use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
struct FileResult {
    success: bool,
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<FileResult, String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(FileResult { success: true })
}

#[tauri::command]
fn get_filename(path: String) -> String {
    Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_file, save_file, get_filename])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
