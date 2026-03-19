use tauri::Window;

#[tauri::command]
pub async fn run_recursive_search(
    path: String,
    query: String,
    nav_id: String,
    window: Window,
) -> Result<(), String> {
    crate::sta_worker::StaWorker::global()
        .recursive_search(crate::expand_env_vars(&path), query, nav_id, window)
        .await
}
