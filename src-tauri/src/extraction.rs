use serde::Serialize;
use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::Path;

use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::Emitter;

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percentage: f32,
    current_file: String,
}

/// Helper: update taskbar + emit event, but only if percentage changed by ≥1%
fn report_progress(
    window: &tauri::Window,
    last_pct: &mut u32,
    bytes_written: u64,
    total_bytes: u64,
    current_file: &str,
) {
    if total_bytes == 0 {
        return;
    }
    let pct = ((bytes_written as f64 / total_bytes as f64) * 100.0).min(100.0) as u32;
    if pct <= *last_pct {
        return; // skip duplicate updates
    }
    *last_pct = pct;

    let _ = window.emit(
        "extraction-progress",
        ProgressPayload {
            percentage: pct as f32,
            current_file: current_file.to_string(),
        },
    );
    let _ = window.set_progress_bar(ProgressBarState {
        progress: Some(pct as u64),
        status: Some(ProgressBarStatus::Normal),
    });
}

/// Extract a ZIP or 7Z archive to the target directory.
/// Returns the path to the extracted folder/files on success.
#[tauri::command]
pub async fn extract_archive(
    window: tauri::Window,
    archive_path: String,
    target_dir: String,
) -> Result<String, String> {
    let archive = archive_path.clone();
    let target = target_dir.clone();

    tokio::task::spawn_blocking(move || {
        let path = Path::new(&archive);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("extracted")
            .to_string();

        let result = match ext.as_str() {
            "zip" => extract_zip(&window, &archive, &target, &stem),
            "7z" => extract_7z(&window, &archive, &target, &stem),
            _ => Err(format!("Unsupported archive format: .{}", ext)),
        };

        // Send 100% and wait briefly so Windows can animate the full bar
        let _ = window.set_progress_bar(ProgressBarState {
            progress: Some(100),
            status: Some(ProgressBarStatus::Normal),
        });
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Reset progress bar
        let _ = window.set_progress_bar(ProgressBarState {
            progress: None,
            status: Some(ProgressBarStatus::None),
        });

        result
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Extract a ZIP archive using the `zip` crate with byte-level progress.
fn extract_zip(
    window: &tauri::Window,
    archive_path: &str,
    target_dir: &str,
    stem: &str,
) -> Result<String, String> {
    let file =
        fs::File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    if archive.len() == 0 {
        return Err("Archive is empty".into());
    }

    // Pre-scan: sum total uncompressed bytes
    let mut total_bytes: u64 = 0;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            total_bytes += entry.size();
        }
    }

    let output_dir = determine_output_dir(&mut archive, target_dir, stem)?;
    fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let single_root = get_zip_single_root(&mut archive);

    let mut bytes_written: u64 = 0;
    let mut last_pct: u32 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read entry {}: {}", i, e))?;

        let entry_name = entry.name().to_string();

        // Build the output path, stripping the single root prefix if needed
        let relative_path = if let Some(ref root) = single_root {
            entry_name
                .strip_prefix(root)
                .unwrap_or(&entry_name)
                .to_string()
        } else {
            entry_name.clone()
        };

        if relative_path.is_empty() {
            continue;
        }

        let out_path = Path::new(&output_dir).join(&relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory {:?}: {}", out_path, e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file {:?}: {}", out_path, e))?;

            // Buffered copy with byte-level progress
            let mut buf = [0u8; 65536]; // 64KB buffer
            loop {
                let n = entry
                    .read(&mut buf)
                    .map_err(|e| format!("Failed to read from archive: {}", e))?;
                if n == 0 {
                    break;
                }
                out_file
                    .write_all(&buf[..n])
                    .map_err(|e| format!("Failed to write file {:?}: {}", out_path, e))?;
                bytes_written += n as u64;
                report_progress(
                    window,
                    &mut last_pct,
                    bytes_written,
                    total_bytes,
                    &entry_name,
                );
            }
        }
    }

    Ok(output_dir)
}

/// Extract a 7Z archive using the `sevenz-rust` crate with byte-level progress.
fn extract_7z(
    window: &tauri::Window,
    archive_path: &str,
    target_dir: &str,
    stem: &str,
) -> Result<String, String> {
    let output_dir = get_unique_dir(target_dir, stem);

    fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Pre-scan: count total uncompressed bytes from archive metadata
    let file = fs::File::open(archive_path).map_err(|e| format!("Failed to open 7z: {}", e))?;
    let len = file
        .metadata()
        .map_err(|e| format!("Failed to get 7z metadata: {}", e))?
        .len();
    let reader = sevenz_rust::SevenZReader::new(file, len, sevenz_rust::Password::empty())
        .map_err(|e| format!("Failed to read 7z: {}", e))?;

    let total_bytes: u64 = reader.archive().files.iter().map(|f| f.size()).sum();

    if total_bytes == 0 {
        return Err("Archive is empty".into());
    }

    let win_clone = window.clone();
    let mut bytes_written: u64 = 0;
    let mut last_pct: u32 = 0;

    sevenz_rust::decompress_file_with_extract_fn(
        archive_path,
        &output_dir,
        move |entry, reader, dest| {
            let entry_name = entry.name().to_string();

            // Skip directories — they have no stream data
            if entry.is_directory() {
                let dir_path = dest.join(&entry_name);
                let _ = fs::create_dir_all(&dir_path);
                return Ok(true);
            }

            // Build output path and create parent dirs
            let out_path = dest.join(&entry_name);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    sevenz_rust::Error::other(format!("Failed to create parent dir: {}", e))
                })?;
            }

            let mut out_file = fs::File::create(&out_path).map_err(|e| {
                sevenz_rust::Error::other(format!("Failed to create file {:?}: {}", out_path, e))
            })?;

            // Manual buffered copy with byte-level progress (same as ZIP)
            let mut buf = [0u8; 65536]; // 64KB buffer
            loop {
                let n = reader
                    .read(&mut buf)
                    .map_err(|e| sevenz_rust::Error::io(e))?;
                if n == 0 {
                    break;
                }
                out_file
                    .write_all(&buf[..n])
                    .map_err(|e| sevenz_rust::Error::io(e))?;
                bytes_written += n as u64;

                // Throttled progress update (≥1% change)
                let pct = ((bytes_written as f64 / total_bytes as f64) * 100.0).min(100.0) as u32;
                if pct > last_pct {
                    last_pct = pct;
                    let _ = win_clone.emit(
                        "extraction-progress",
                        ProgressPayload {
                            percentage: pct as f32,
                            current_file: entry_name.clone(),
                        },
                    );
                    let _ = win_clone.set_progress_bar(ProgressBarState {
                        progress: Some(pct as u64),
                        status: Some(ProgressBarStatus::Normal),
                    });
                }
            }

            Ok(true)
        },
    )
    .map_err(|e| format!("Failed to extract 7Z archive: {}", e))?;

    flatten_single_child_dir(&output_dir)?;

    Ok(output_dir)
}

/// Get a unique directory path, appending " (2)", " (3)", etc. if it already exists.
fn get_unique_dir(parent: &str, name: &str) -> String {
    let base = Path::new(parent).join(name);
    if !base.exists() {
        return base.to_string_lossy().to_string();
    }

    let mut counter = 2;
    loop {
        let candidate = Path::new(parent).join(format!("{} ({})", name, counter));
        if !candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
        counter += 1;
    }
}

/// For ZIP: determine the output directory path
fn determine_output_dir(
    _archive: &mut zip::ZipArchive<fs::File>,
    target_dir: &str,
    stem: &str,
) -> Result<String, String> {
    Ok(get_unique_dir(target_dir, stem))
}

/// Check if a ZIP archive has a single root folder that contains everything.
fn get_zip_single_root(archive: &mut zip::ZipArchive<fs::File>) -> Option<String> {
    if archive.len() == 0 {
        return None;
    }

    let mut root_entries = std::collections::HashSet::new();

    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if let Some(first_slash) = name.find('/') {
                root_entries.insert(name[..=first_slash].to_string());
            } else {
                return None;
            }
        }
    }

    if root_entries.len() == 1 {
        root_entries.into_iter().next()
    } else {
        None
    }
}

/// If a directory contains exactly one child that is a directory,
/// move all of its contents up and remove the child directory.
fn flatten_single_child_dir(dir: &str) -> Result<(), String> {
    let entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    if entries.len() == 1 && entries[0].path().is_dir() {
        let child_dir = entries[0].path();
        let temp_name = format!("__flatten_temp_{}", std::process::id());
        let temp_path = Path::new(dir).parent().unwrap().join(&temp_name);

        fs::rename(&child_dir, &temp_path)
            .map_err(|e| format!("Failed to move child dir: {}", e))?;
        fs::remove_dir(dir).map_err(|e| format!("Failed to remove empty dir: {}", e))?;
        fs::rename(&temp_path, dir)
            .map_err(|e| format!("Failed to restore flattened dir: {}", e))?;
    }

    Ok(())
}
