use base64::prelude::*;
use chrono::{DateTime, Local};
use clipboard_win::{formats, Clipboard};
use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::sync::OnceLock;
use std::time::SystemTime;
// use tauri::Emitter; // Moved to drop_overlay.rs
use tauri::Manager;
// use window_vibrancy::apply_mica;
use windows::core::{Interface, PCWSTR};

use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Security::TOKEN_QUERY;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED, STGM};
use windows::Win32::System::DataExchange::{
    EmptyClipboard, GetClipboardSequenceNumber, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Shell::{
    IShellItem2, IShellItemImageFactory, SHCreateItemFromParsingName, SHFileOperationW,
    SHQueryRecycleBinW, FOF_ALLOWUNDO, FOF_MULTIDESTFILES, FOF_NOCONFIRMATION, FO_COPY, FO_DELETE,
    FO_MOVE, FO_RENAME, SHFILEOPSTRUCTW, SHQUERYRBINFO, SIIGBF_ICONONLY, SIIGBF_THUMBNAILONLY,
};

mod commands;
mod drop_overlay;
mod extraction;
mod sta_worker;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct ClipboardInfo {
    pub has_files: bool,
    pub paths: Vec<String>,
    pub is_cut: bool,
    pub file_count: usize,
    pub file_summary: Option<String>,
    pub has_image: bool,
    pub image_data: Option<String>, // Base64 Data URI
}

pub struct ClipboardCache(std::sync::Mutex<Option<(u32, ClipboardInfo)>>);

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
}

#[derive(Serialize, Default, Clone)]
pub struct RecycleBinStatus {
    pub is_empty: bool,
    pub item_count: i64,
    pub total_size: i64,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub formatted_size: String,
    pub file_type: String,
    pub created_at: String,
    pub modified_at: String,
    pub is_shortcut: bool,
    pub disk_info: Option<DiskInfo>,
    pub modified_timestamp: i64,
    pub dimensions: Option<String>,
}

pub fn get_file_entry(path: &std::path::Path) -> Result<FileEntry, String> {
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();
    let path_string = path.to_string_lossy().to_string();
    let is_dir = metadata.is_dir();
    let size = if is_dir { 0 } else { metadata.len() };

    let formatted_size = if is_dir {
        String::new()
    } else if size < 1024 {
        format!("{} B", size)
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    };

    let file_type = if is_dir {
        "Folder".to_string()
    } else {
        path.extension()
            .map(|ext| ext.to_string_lossy().to_uppercase() + " File")
            .unwrap_or_else(|| "File".to_string())
    };

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();
    let is_shortcut = extension == "lnk";

    let file_type = if is_shortcut {
        "Shortcut".to_string()
    } else {
        file_type
    };

    let created_at = metadata.created().unwrap_or_else(|_| SystemTime::now());
    let created_datetime: DateTime<Local> = created_at.into();
    let created_at_str = created_datetime.format("%d/%m/%Y %H:%M").to_string();

    let modified_at = metadata.modified().unwrap_or_else(|_| SystemTime::now());
    let modified_datetime: DateTime<Local> = modified_at.into();
    let modified_at_str = modified_datetime.format("%d/%m/%Y %H:%M").to_string();

    Ok(FileEntry {
        name,
        path: path_string,
        is_dir,
        size,
        formatted_size,
        file_type,
        created_at: created_at_str,
        modified_at: modified_at_str,
        is_shortcut,
        disk_info: None,
        modified_timestamp: modified_at
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64,
        dimensions: None,
    })
}

#[tauri::command]
fn list_files(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    crate::sta_worker::StaWorker::global().list_files(path.to_string(), show_hidden)
}

#[tauri::command]
fn read_file_base64(path: &str) -> Result<String, String> {
    Ok(BASE64_STANDARD.encode(fs::read(path).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn show_item_properties(path: String) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW},
        };

        let path_wide: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let verb_wide: Vec<u16> = std::ffi::OsStr::new("properties")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_INVOKEIDLIST,
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            lpVerb: PCWSTR(verb_wide.as_ptr()),
            lpFile: PCWSTR(path_wide.as_ptr()),
            nShow: 1,
            ..Default::default()
        };

        unsafe {
            let _ = ShellExecuteExW(&mut info);
        }
    }
}

#[tauri::command]
fn open_file(
    path: String,
    opener: tauri::State<'_, tauri_plugin_opener::Opener<tauri::Wry>>,
) -> Result<(), String> {
    opener
        .open_path(path, None::<String>)
        .map_err(|e: tauri_plugin_opener::Error| e.to_string())
}

#[tauri::command]
fn create_folder(parent_path: String) -> Result<String, String> {
    use windows::Win32::UI::Shell::SHCreateDirectoryExW;

    let folder_name = "New Folder".to_string();
    let mut count = 1;

    loop {
        let name = if count == 1 {
            folder_name.clone()
        } else {
            format!("{} ({})", folder_name, count)
        };

        let path_obj = std::path::Path::new(&parent_path).join(&name);
        if !path_obj.exists() {
            let path_wide: Vec<u16> = OsStr::new(path_obj.as_os_str())
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            unsafe {
                let result = SHCreateDirectoryExW(
                    Some(windows::Win32::Foundation::HWND(std::ptr::null_mut())),
                    PCWSTR(path_wide.as_ptr()),
                    None,
                );

                if result != 0 && result != 183 {
                    return Err(format!(
                        "Windows Folder Creation failed with code: {}",
                        result
                    ));
                }
            }
            return Ok(name);
        }
        count += 1;
    }
}

#[tauri::command]
fn open_with(path: String) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW},
        };

        let path_wide: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let verb_wide: Vec<u16> = std::ffi::OsStr::new("openas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_INVOKEIDLIST,
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            lpVerb: PCWSTR(verb_wide.as_ptr()),
            lpFile: PCWSTR(path_wide.as_ptr()),
            nShow: 1,
            ..Default::default()
        };

        unsafe {
            let _ = ShellExecuteExW(&mut info);
        }
    }
}

#[tauri::command]
fn delete_item(path: String) -> Result<(), String> {
    let from_wide: Vec<u16> = OsStr::new(&path)
        .encode_wide()
        .chain(std::iter::once(0))
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(std::ptr::null()),
            fFlags: (FOF_ALLOWUNDO.0 as u16),
            fAnyOperationsAborted: windows_core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Delete failed with code: {}", result));
        }

        if file_op.fAnyOperationsAborted.0 != 0 {
            return Err("Deletion aborted by user".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn rename_item(old_path: String, new_name: String) -> Result<(), String> {
    let old_path_p = std::path::Path::new(&old_path);
    if !old_path_p.exists() {
        return Err("The file or folder does not exist".into());
    }

    let parent = old_path_p
        .parent()
        .ok_or("Could not find parent directory")?;
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err("An item with the same name already exists".into());
    }

    let from_wide: Vec<u16> = OsStr::new(&old_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .chain(std::iter::once(0))
        .collect();
    let to_wide: Vec<u16> = OsStr::new(new_path.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_RENAME,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(to_wide.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 as u16),
            fAnyOperationsAborted: windows_core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Rename failed with code: {}", result));
        }

        if file_op.fAnyOperationsAborted.0 != 0 {
            return Err("Rename aborted by user".to_string());
        }
    }

    Ok(())
}

fn set_file_drop(paths: Vec<String>, effect: u32) -> Result<(), String> {
    let _clip = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;

    unsafe {
        let _ = EmptyClipboard();
    }

    let mut buffer = Vec::new();
    buffer.extend_from_slice(&20u32.to_ne_bytes());
    buffer.extend_from_slice(&0u32.to_ne_bytes());
    buffer.extend_from_slice(&0u32.to_ne_bytes());
    buffer.extend_from_slice(&0u32.to_ne_bytes());
    buffer.extend_from_slice(&1u32.to_ne_bytes());

    for path in &paths {
        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        for w in wide {
            buffer.extend_from_slice(&w.to_ne_bytes());
        }
    }
    buffer.extend_from_slice(&0u16.to_ne_bytes());

    let size = buffer.len();
    unsafe {
        let h_global = GlobalAlloc(GMEM_MOVEABLE, size).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(h_global);
        std::ptr::copy_nonoverlapping(buffer.as_ptr(), ptr as *mut u8, size);
        let _ = GlobalUnlock(h_global);

        SetClipboardData(
            15,
            Some(windows::Win32::Foundation::HANDLE(h_global.0 as *mut _)),
        )
        .map_err(|e: windows::core::Error| e.to_string())?;
    }

    let format_id = clipboard_win::register_format("Preferred DropEffect")
        .ok_or("Failed to register format")?;

    let effect_bytes = effect.to_ne_bytes().to_vec();
    let size_effect = effect_bytes.len();

    unsafe {
        let h_global = GlobalAlloc(GMEM_MOVEABLE, size_effect)
            .map_err(|e: windows::core::Error| e.to_string())?;
        let ptr = GlobalLock(h_global);
        std::ptr::copy_nonoverlapping(effect_bytes.as_ptr(), ptr as *mut u8, size_effect);
        let _ = GlobalUnlock(h_global);

        SetClipboardData(
            format_id.get(),
            Some(windows::Win32::Foundation::HANDLE(h_global.0 as *mut _)),
        )
        .map_err(|e: windows::core::Error| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn copy_items(paths: Vec<String>) -> Result<(), String> {
    set_file_drop(paths, 1)
}

#[tauri::command]
fn cut_items(paths: Vec<String>) -> Result<(), String> {
    set_file_drop(paths, 2)
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        Command::new("cmd")
            .args(["/c", "start", "wt.exe", "-d", "."])
            .current_dir(&path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Only supported on Windows".to_string())
    }
}

#[tauri::command]
fn resolve_shortcut(path: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER};
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

        unsafe {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("CoCreateInstance failed: {}", e))?;

            let persist_file: IPersistFile = shell_link
                .cast()
                .map_err(|e| format!("QueryInterface(IPersistFile) failed: {}", e))?;

            let path_wide: Vec<u16> = OsStr::new(&path)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            persist_file
                .Load(windows::core::PCWSTR(path_wide.as_ptr()), STGM(0))
                .map_err(|e| format!("IPersistFile::Load failed: {}", e))?;

            let mut target_path = [0u16; 260];
            shell_link
                .GetPath(&mut target_path, std::ptr::null_mut(), 0)
                .map_err(|e| format!("IShellLink::GetPath failed: {}", e))?;

            let end = target_path
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(target_path.len());
            Ok(String::from_utf16_lossy(&target_path[..end]))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported operating system".into())
    }
}

pub fn get_next_available_path(target_dir: &str, original_name: &str) -> std::path::PathBuf {
    let base_path = std::path::Path::new(target_dir).join(original_name);
    if !base_path.exists() {
        return base_path;
    }

    let stem = base_path.file_stem().unwrap_or_default().to_string_lossy();
    let extension = base_path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let copy_name = format!("{} - Copia{}", stem, extension);
    let mut check_path = std::path::Path::new(target_dir).join(&copy_name);
    if !check_path.exists() {
        return check_path;
    }

    let mut count = 2;
    loop {
        let name = format!("{} - Copia ({}){}", stem, count, extension);
        check_path = std::path::Path::new(target_dir).join(&name);
        if !check_path.exists() {
            return check_path;
        }
        count += 1;
    }
}

#[tauri::command]
fn save_clipboard_image(target_path: String) -> Result<FileEntry, String> {
    if clipboard_win::is_format_avail(formats::CF_DIB.into()) {
        if let Ok(dib_bytes) =
            clipboard_win::get_clipboard::<Vec<u8>, _>(formats::RawData(formats::CF_DIB.into()))
        {
            if dib_bytes.len() >= 40 {
                let bi_size = u32::from_le_bytes(dib_bytes[0..4].try_into().unwrap());
                let bi_bit_count = u16::from_le_bytes(dib_bytes[14..16].try_into().unwrap());
                let bi_compression = u32::from_le_bytes(dib_bytes[16..20].try_into().unwrap());

                let mut offset = 14 + bi_size;

                if bi_bit_count <= 8 {
                    let mut colors_used = u32::from_le_bytes(dib_bytes[32..36].try_into().unwrap());
                    if colors_used == 0 {
                        colors_used = 1 << bi_bit_count;
                    }
                    offset += colors_used * 4;
                } else if bi_compression == 3 {
                    offset += 12;
                }

                let mut bmp_data = Vec::with_capacity(14 + dib_bytes.len());
                bmp_data.extend_from_slice(b"BM");
                let file_size = (14 + dib_bytes.len()) as u32;
                bmp_data.extend_from_slice(&file_size.to_le_bytes());
                bmp_data.extend_from_slice(&[0, 0, 0, 0]);
                bmp_data.extend_from_slice(&offset.to_le_bytes());
                bmp_data.extend_from_slice(&dib_bytes);

                if let Ok(img) =
                    image::load_from_memory_with_format(&bmp_data, image::ImageFormat::Bmp)
                {
                    let now = chrono::Local::now();
                    let filename = format!("Screenshot_{}.jpg", now.format("%d_%m_%Y_%H_%M_%S"));
                    let target_file_path = get_next_available_path(&target_path, &filename);

                    if let Err(e) = img.save(&target_file_path) {
                        let err_str = e.to_string();
                        if err_str.contains("os error 5")
                            || err_str.to_lowercase().contains("access is denied")
                        {
                            let temp_dir = std::env::temp_dir();
                            let temp_path = temp_dir.join(&filename);

                            img.save(&temp_path)
                                .map_err(|e| format!("Failed to save temp image: {}", e))?;

                            let cmd = "cmd.exe";
                            let params = format!(
                                "/c move /Y \"{}\" \"{}\"",
                                temp_path.display(),
                                target_file_path.display()
                            );

                            use windows::Win32::UI::Shell::ShellExecuteW;
                            use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

                            let file_wide: Vec<u16> = OsStr::new(cmd)
                                .encode_wide()
                                .chain(std::iter::once(0))
                                .collect();
                            let params_wide: Vec<u16> = OsStr::new(&params)
                                .encode_wide()
                                .chain(std::iter::once(0))
                                .collect();
                            let verb_wide: Vec<u16> = OsStr::new("runas")
                                .encode_wide()
                                .chain(std::iter::once(0))
                                .collect();

                            unsafe {
                                let result = ShellExecuteW(
                                    Some(windows::Win32::Foundation::HWND(std::ptr::null_mut())),
                                    PCWSTR(verb_wide.as_ptr()),
                                    PCWSTR(file_wide.as_ptr()),
                                    PCWSTR(params_wide.as_ptr()),
                                    PCWSTR(std::ptr::null()),
                                    SW_HIDE,
                                );

                                if (result.0 as isize) <= 32 {
                                    return Err(
                                        "Failed to request admin permissions or user cancelled"
                                            .to_string(),
                                    );
                                }
                            }
                            return get_file_entry(&target_file_path);
                        } else {
                            return Err(format!("Failed to save image: {}", e));
                        }
                    }
                    return get_file_entry(&target_file_path);
                }
            }
        }
    }
    return Err("Clipboard is empty or format not supported".into());
}

#[tauri::command]
fn paste_items(target_path: String) -> Result<Vec<String>, String> {
    let paths: Vec<String> = clipboard_win::get_clipboard(formats::FileList).unwrap_or_default();

    if paths.is_empty() {
        return Err("Clipboard is empty".into());
    }

    let mut operation = FO_COPY;
    if let Some(format_id) = clipboard_win::register_format("Preferred DropEffect") {
        if clipboard_win::is_format_avail(format_id.get()) {
            let raw_format = formats::RawData(format_id.get());
            if let Ok(buffer) = clipboard_win::get_clipboard::<Vec<u8>, _>(raw_format) {
                if buffer.len() >= 4 {
                    let val = u32::from_ne_bytes(buffer[0..4].try_into().unwrap());
                    if val == 2 {
                        operation = FO_MOVE;
                    }
                }
            }
        }
    }

    let mut from_wide: Vec<u16> = Vec::new();
    let mut to_wide: Vec<u16> = Vec::new();
    let mut pasted_paths: Vec<String> = Vec::new();

    for f in &paths {
        from_wide.extend(OsStr::new(f).encode_wide());
        from_wide.push(0);

        let path_obj = std::path::Path::new(f);
        let filename = path_obj
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|| "unknown".into());

        // Calculate unique destination path to avoid overwrite
        // This handles the "- Copia" suffix logic
        let dest_path_buf = get_next_available_path(&target_path, &filename);
        let dest_path_str = dest_path_buf.to_string_lossy().to_string();
        pasted_paths.push(dest_path_str.clone());

        to_wide.extend(dest_path_buf.as_os_str().encode_wide());
        to_wide.push(0);
    }
    from_wide.push(0); // Double null termination
    to_wide.push(0); // Double null termination

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: operation,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(to_wide.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 as u16) | (FOF_MULTIDESTFILES.0 as u16),
            fAnyOperationsAborted: windows_core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Copy/Move failed with code: {}", result));
        }

        // Always empty the clipboard after success so the UI dimming is removed immediately.
        // Retry a few times in case check_clipboard holds the lock
        let mut cleared = false;
        for i in 0..10 {
            use windows::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};

            if OpenClipboard(None).is_ok() {
                if EmptyClipboard().is_ok() {
                    cleared = true;
                } else {
                    println!("Failed to EmptyClipboard on attempt {}", i);
                }
                let _ = CloseClipboard();
            } else {
                println!("Failed to OpenClipboard on attempt {}", i);
            }

            if cleared {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        if !cleared {
            println!("CRITICAL: Failed to clear clipboard after 10 attempts.");
        }
    }
    Ok(pasted_paths)
}

/// Handle files dropped from external applications (Windows Explorer, etc.)
/// This bypasses clipboard and directly copies files to the target directory.
#[tauri::command]
fn drop_items(files: Vec<String>, target_path: String) -> Result<Vec<String>, String> {
    crate::sta_worker::StaWorker::global().drop_items(files, target_path)
}

#[tauri::command]
fn move_items(paths: Vec<String>, target_path: String) -> Result<(), String> {
    crate::sta_worker::StaWorker::global().move_items(paths, target_path)
}

#[tauri::command]
fn delete_items(paths: Vec<String>, silent: bool) -> Result<(), String> {
    let mut from_wide: Vec<u16> = Vec::new();
    for f in &paths {
        from_wide.extend(OsStr::new(f).encode_wide());
        from_wide.push(0);
    }
    from_wide.push(0);

    unsafe {
        let mut flags = FOF_ALLOWUNDO.0 as u16;
        if silent {
            flags |= FOF_NOCONFIRMATION.0 as u16;
        }

        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(std::ptr::null()),
            fFlags: flags,
            fAnyOperationsAborted: windows_core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Bulk Delete failed with code: {}", result));
        }
    }
    Ok(())
}

#[derive(serde::Serialize, Clone)]
struct ThumbnailResult {
    data: String,
    source: String, // "native" or "ffmpeg"
}

struct ThumbnailCache(std::sync::Mutex<lru::LruCache<String, ThumbnailResult>>);

#[tauri::command]
async fn get_video_thumbnail(
    path: String,
    size: u32,
    modified: i64,
    state: tauri::State<'_, ThumbnailCache>,
) -> Result<ThumbnailResult, String> {
    let cache_key = format!("video:{}:{}:{}", path, size, modified);
    {
        let mut cache = state.0.lock().unwrap();
        if let Some(res) = cache.get(&cache_key) {
            return Ok(res.clone());
        }
    }

    // 1. Try Native Shell first
    let path_clone = path.clone();
    let native_res =
        tokio::task::spawn_blocking(move || generate_shell_thumbnail(&path_clone, size))
            .await
            .map_err(|e| format!("Task join error: {}", e))?;

    if let Ok((data_uri, _)) = native_res {
        let result = ThumbnailResult {
            data: data_uri,
            source: "native".to_string(),
        };
        let mut cache = state.0.lock().unwrap();
        cache.put(cache_key, result.clone());
        return Ok(result);
    }

    // 2. Fallback to FFmpeg
    let mut cmd = tokio::process::Command::new("ffmpeg");

    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .arg("-ss")
        .arg("2.0")
        .arg("-i")
        .arg(&path)
        .arg("-vf")
        .arg("scale=480:-1:flags=lanczos")
        .arg("-vframes")
        .arg("1")
        .arg("-f")
        .arg("image2")
        .arg("-c:v")
        .arg("mjpeg")
        .arg("pipe:1")
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err("FFmpeg failed".to_string());
    }

    let base64_img = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    let data_uri = format!("data:image/jpeg;base64,{}", base64_img);

    let result = ThumbnailResult {
        data: data_uri,
        source: "ffmpeg".to_string(),
    };

    {
        let mut cache = state.0.lock().unwrap();
        cache.put(cache_key, result.clone());
    }

    Ok(result)
}

fn generate_shell_thumbnail(path: &str, size: u32) -> Result<(String, Option<String>), String> {
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let shell_item: IShellItem2 =
            match SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) {
                Ok(si) => si,
                Err(_) => {
                    CoUninitialize();
                    return Err("Failed to create shell item".to_string());
                }
            };

        let image_factory: IShellItemImageFactory = match shell_item.cast() {
            Ok(f) => f,
            Err(_) => {
                CoUninitialize();
                return Err("Failed to cast to ImageFactory".to_string());
            }
        };

        let thumb_size = SIZE {
            cx: size as i32,
            cy: size as i32,
        };

        let hbitmap: HBITMAP =
            if let Ok(h) = image_factory.GetImage(thumb_size, SIIGBF_THUMBNAILONLY) {
                h
            } else if let Ok(h) = image_factory.GetImage(thumb_size, SIIGBF_ICONONLY) {
                h
            } else {
                CoUninitialize();
                return Err("Failed to get image".to_string());
            };

        let mut bmp = BITMAP::default();
        let result = GetObjectW(
            hbitmap.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );

        if result == 0 {
            let _ = DeleteObject(hbitmap.into());
            CoUninitialize();
            return Err("Failed to get bitmap info".to_string());
        }

        let width = bmp.bmWidth as u32;
        let height = bmp.bmHeight as u32;

        let hdc = CreateCompatibleDC(None);
        let old_bitmap = SelectObject(hdc, hbitmap.into());

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        GetDIBits(
            hdc,
            hbitmap.into(),
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc, old_bitmap);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbitmap.into());
        CoUninitialize();

        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let img = image::RgbaImage::from_raw(width, height, pixels)
            .ok_or("Failed to create image from pixels")?;

        let mut cursor = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut cursor, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode image: {}", e))?;

        let base64_data = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());
        Ok((format!("data:image/jpeg;base64,{}", base64_data), None))
    }
}

#[tauri::command]
async fn get_thumbnail(
    path: String,
    size: u32,
    modified: i64,
    state: tauri::State<'_, ThumbnailCache>,
) -> Result<ThumbnailResult, String> {
    let cache_key = format!("image:{}:{}:{}", path, size, modified);

    {
        let mut cache = state.0.lock().unwrap();
        if let Some(res) = cache.get(&cache_key) {
            return Ok(res.clone());
        }
    }

    let path_clone = path.clone();
    let data_uri = tokio::task::spawn_blocking(move || generate_shell_thumbnail(&path_clone, size))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    let result = ThumbnailResult {
        data: data_uri.0,
        source: "native".to_string(),
    };

    {
        let mut cache = state.0.lock().unwrap();
        cache.put(cache_key, result.clone());
    }

    Ok(result)
}

#[tauri::command]
async fn get_file_dimensions(path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let path_wide: Vec<u16> = std::ffi::OsStr::new(&path)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let shell_item: IShellItem2 =
                match SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) {
                    Ok(si) => si,
                    Err(_) => {
                        CoUninitialize();
                        return Ok(None);
                    }
                };

            // PKEY_Video_FrameWidth: {64440489-4C8E-11D1-8C70-00C04FC2B64F}, 3
            let k_width = PROPERTYKEY {
                fmtid: windows::core::GUID::from_values(
                    0x64440489,
                    0x4C8E,
                    0x11D1,
                    [0x8C, 0x70, 0x00, 0xC0, 0x4F, 0xC2, 0xB6, 0x4F],
                ),
                pid: 3,
            };
            // PKEY_Video_FrameHeight: {64440489-4C8E-11D1-8C70-00C04FC2B64F}, 4
            let k_height = PROPERTYKEY {
                fmtid: windows::core::GUID::from_values(
                    0x64440489,
                    0x4C8E,
                    0x11D1,
                    [0x8C, 0x70, 0x00, 0xC0, 0x4F, 0xC2, 0xB6, 0x4F],
                ),
                pid: 4,
            };

            if let (Ok(w), Ok(h)) = (
                shell_item.GetUInt32(&k_width),
                shell_item.GetUInt32(&k_height),
            ) {
                if w > 0 && h > 0 {
                    CoUninitialize();
                    return Ok(Some(format!("{}x{}", w, h)));
                }
            }

            // Fallback for images
            if let Ok((w, h)) = image::image_dimensions(&path) {
                CoUninitialize();
                return Ok(Some(format!("{}x{}", w, h)));
            }

            // Fallback for videos (FFmpeg probe)
            let mut cmd = std::process::Command::new("ffmpeg");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            let output = cmd.args(&["-i", &path]).output();

            if let Ok(output) = output {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if let Some(v_idx) = stderr.find("Video:") {
                    let sub = &stderr[v_idx..];
                    let parts: Vec<&str> = sub.split(',').collect();
                    for part in parts {
                        let part = part.trim();
                        if let Some(x_idx) = part.find('x') {
                            if x_idx > 0 && x_idx < part.len() - 1 {
                                let w_str = &part[0..x_idx];
                                let h_str = &part[x_idx + 1..];
                                let h_str_clean = h_str.split_whitespace().next().unwrap_or(h_str);
                                if w_str.chars().all(char::is_numeric)
                                    && h_str_clean.chars().all(char::is_numeric)
                                {
                                    CoUninitialize();
                                    return Ok(Some(format!("{}x{}", w_str, h_str_clean)));
                                }
                            }
                        }
                    }
                }
            }

            CoUninitialize();
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_system_default_paths() -> Result<std::collections::HashMap<String, String>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Pictures,
            SHGetKnownFolderPath, KF_FLAG_DEFAULT,
        };

        let mut paths = std::collections::HashMap::new();
        let folder_ids = [
            ("downloads", FOLDERID_Downloads),
            ("documents", FOLDERID_Documents),
            ("pictures", FOLDERID_Pictures),
            ("desktop", FOLDERID_Desktop),
        ];

        for (key, id) in folder_ids {
            unsafe {
                if let Ok(path_ptr) = SHGetKnownFolderPath(&id, KF_FLAG_DEFAULT, None) {
                    let path_str = path_ptr.to_string().map_err(|e| e.to_string())?;
                    paths.insert(key.to_string(), path_str);
                    windows::Win32::System::Com::CoTaskMemFree(Some(path_ptr.as_ptr() as *const _));
                }
            }
        }
        Ok(paths)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported operating system".into())
    }
}

#[tauri::command]
fn get_clipboard_info(state: tauri::State<'_, ClipboardCache>) -> Result<ClipboardInfo, String> {
    let mut info = ClipboardInfo {
        has_files: false,
        paths: Vec::new(),
        is_cut: false,
        file_count: 0,
        file_summary: None,
        has_image: false,
        image_data: None,
    };

    let seq = unsafe { GetClipboardSequenceNumber() };

    {
        let cache = state.0.lock().unwrap();
        if let Some((cached_seq, cached_info)) = &*cache {
            if *cached_seq == seq {
                return Ok(cached_info.clone());
            }
        }
    }

    // 1. Extract raw data (Paths, PreferredDropEffect, DIB) QUICKLY while holding the lock
    let (paths, is_cut, dib_bytes) = {
        let mut p = Vec::new();
        let mut c = false;
        let mut d = Vec::new();

        if let Ok(_clip) = Clipboard::new() {
            if let Ok(fetched_paths) =
                clipboard_win::get_clipboard::<Vec<String>, _>(formats::FileList)
            {
                p = fetched_paths;
            }

            if !p.is_empty() {
                if let Some(format_id) = clipboard_win::register_format("Preferred DropEffect") {
                    if clipboard_win::is_format_avail(format_id.get()) {
                        let raw_format = formats::RawData(format_id.get());
                        if let Ok(buffer) = clipboard_win::get_clipboard::<Vec<u8>, _>(raw_format) {
                            if buffer.len() >= 4 {
                                let val = u32::from_ne_bytes(buffer[0..4].try_into().unwrap());
                                if val == 2 {
                                    c = true;
                                }
                            }
                        }
                    }
                }
            }

            if clipboard_win::is_format_avail(formats::CF_DIB.into()) {
                if let Ok(bytes) = clipboard_win::get_clipboard::<Vec<u8>, _>(formats::RawData(
                    formats::CF_DIB.into(),
                )) {
                    d = bytes;
                }
            }
        }
        (p, c, d)
    };

    // 2. Process data (Thumbnails, etc.) WITHOUT holding the clipboard lock
    if !paths.is_empty() {
        info.has_files = true;
        info.paths = paths.clone();
        info.file_count = paths.len();
        info.is_cut = is_cut;

        // If it's a single image file, try to load it for preview
        if paths.len() == 1 {
            let path_obj = std::path::Path::new(&paths[0]);
            let ext = path_obj
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            if ["png", "jpg", "jpeg", "bmp", "webp", "gif"].contains(&ext.as_str()) {
                // Use shell thumbnail (fast, uses Windows cache) instead of image::open
                if let Ok((data_uri, _)) = generate_shell_thumbnail(&paths[0], 1200) {
                    info.has_image = true;
                    info.image_data = Some(data_uri);
                }
            }
        }

        // If no image data loaded yet
        if info.image_data.is_none() {
            let mut extensions = std::collections::HashMap::new();
            for path in &paths {
                let path_obj = std::path::Path::new(&path);
                if path_obj.is_dir() {
                    *extensions.entry("FOLDER".to_string()).or_insert(0) += 1;
                } else {
                    let ext = path_obj
                        .extension()
                        .map(|e| e.to_string_lossy().to_uppercase())
                        .unwrap_or_else(|| "FILE".to_string());
                    *extensions.entry(ext).or_insert(0) += 1;
                }
            }
            let mut summary_parts = extensions
                .into_iter()
                .map(|(ext, count)| format!("{} {}", count, ext))
                .collect::<Vec<_>>();
            summary_parts.sort();
            info.file_summary = Some(summary_parts.join(", "));
        }
    } else if !dib_bytes.is_empty() {
        // Process copied image data (e.g. from Snipping Tool)
        if dib_bytes.len() >= 40 {
            let bi_size = u32::from_le_bytes(dib_bytes[0..4].try_into().unwrap());
            let bi_bit_count = u16::from_le_bytes(dib_bytes[14..16].try_into().unwrap());
            let bi_compression = u32::from_le_bytes(dib_bytes[16..20].try_into().unwrap());

            let mut offset = 14 + bi_size;

            if bi_bit_count <= 8 {
                let mut colors_used = u32::from_le_bytes(dib_bytes[32..36].try_into().unwrap());
                if colors_used == 0 {
                    colors_used = 1 << bi_bit_count;
                }
                offset += colors_used * 4;
            } else if bi_compression == 3 {
                offset += 12;
            }

            let mut bmp_data = Vec::with_capacity(14 + dib_bytes.len());
            bmp_data.extend_from_slice(b"BM");
            let file_size = (14 + dib_bytes.len()) as u32;
            bmp_data.extend_from_slice(&file_size.to_le_bytes());
            bmp_data.extend_from_slice(&[0, 0, 0, 0]);
            bmp_data.extend_from_slice(&offset.to_le_bytes());
            bmp_data.extend_from_slice(&dib_bytes);

            if let Ok(img) = image::load_from_memory_with_format(&bmp_data, image::ImageFormat::Bmp)
            {
                info.has_image = true;
                // Resize for preview
                let resized = img.resize(1200, 1200, image::imageops::FilterType::Triangle);
                let mut cursor = std::io::Cursor::new(Vec::new());
                if resized
                    .write_to(&mut cursor, image::ImageFormat::Jpeg)
                    .is_ok()
                {
                    let base64_data =
                        base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());
                    info.image_data = Some(format!("data:image/jpeg;base64,{}", base64_data));
                }
            }
        }
    }

    {
        let mut cache = state.0.lock().unwrap();
        *cache = Some((seq, info.clone()));
    }

    Ok(info)
}

#[tauri::command]
async fn check_diagnostics() -> serde_json::Value {
    let mut is_admin = false;
    let mut integrity_level = "Unknown".to_string();

    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TokenIntegrityLevel, TOKEN_ELEVATION,
            TOKEN_MANDATORY_LABEL,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_ok() {
            let mut elevation = TOKEN_ELEVATION::default();
            let mut size = 0;
            if GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut _),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut size,
            )
            .is_ok()
            {
                is_admin = elevation.TokenIsElevated != 0;
            }

            let mut info_size = 0;
            let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut info_size);
            if info_size > 0 {
                let mut buffer = vec![0u8; info_size as usize];
                if GetTokenInformation(
                    token,
                    TokenIntegrityLevel,
                    Some(buffer.as_mut_ptr() as *mut _),
                    info_size,
                    &mut info_size,
                )
                .is_ok()
                {
                    let p_label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
                    let sid = p_label.Label.Sid;
                    let sub_auth_count = *windows::Win32::Security::GetSidSubAuthorityCount(sid);
                    let rid = *windows::Win32::Security::GetSidSubAuthority(
                        sid,
                        (sub_auth_count - 1) as u32,
                    );
                    integrity_level = format!("RID: 0x{:x}", rid);
                }
            }
            let _ = CloseHandle(token);
        }
    }

    let result = serde_json::json!({
        "is_admin": is_admin,
        "integrity_level": integrity_level,
        "os": "windows"
    });
    result
}

#[tauri::command]
async fn debug_window_hierarchy(window: tauri::Window) -> Vec<serde_json::Value> {
    let mut results = Vec::new();
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumChildWindows, GetClassNameW, GetWindowLongW, GWL_EXSTYLE, GWL_STYLE,
        };
        use windows_core::BOOL;

        let main_hwnd = window.hwnd().unwrap();
        let whwnd = windows::Win32::Foundation::HWND(main_hwnd.0 as *mut _);

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let results = &mut *(lparam.0 as *mut Vec<serde_json::Value>);

            let mut class_name = [0u16; 256];
            let len = GetClassNameW(hwnd, &mut class_name);
            let class_str = String::from_utf16_lossy(&class_name[..len as usize]);

            let style = GetWindowLongW(hwnd, GWL_STYLE);
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);

            let visible = (style as u32 & 0x10000000) != 0;
            let enabled = (style as u32 & 0x08000000) == 0;

            let entry = serde_json::json!({
                "hwnd": format!("{:?}", hwnd),
                "class": class_str,
                "style": format!("{:08x}", style),
                "ex_style": format!("{:08x}", ex_style),
                "visible": visible,
                "enabled": enabled,
                "accept_files": (ex_style as u32 & 0x10) != 0
            });

            // Removed legacy forced drag-accept to allow OLE (Tauri) to work.

            results.push(entry);

            BOOL::from(true)
        }

        unsafe {
            let _ = EnumChildWindows(
                Some(whwnd),
                Some(enum_proc),
                LPARAM(&mut results as *mut _ as isize),
            );
        }
    }
    results
}

#[tauri::command]
fn get_recycle_bin_status() -> Result<RecycleBinStatus, String> {
    unsafe {
        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            ..Default::default()
        };

        match SHQueryRecycleBinW(None, &mut info) {
            Ok(_) => Ok(RecycleBinStatus {
                is_empty: info.i64NumItems == 0,
                item_count: info.i64NumItems,
                total_size: info.i64Size,
            }),
            Err(e) => Err(format!("Failed to query recycle bin: {}", e)),
        }
    }
}

#[tauri::command]
fn empty_recycle_bin() -> Result<(), String> {
    crate::sta_worker::StaWorker::global().empty_recycle_bin()
}

/// Window subclass procedure to intercept WM_DROPFILES for legacy drop handling

#[tauri::command]
fn get_dropped_file_paths() -> Result<Vec<String>, String> {
    if let Ok(_clip) = Clipboard::new() {
        if let Ok(paths) = clipboard_win::get_clipboard::<Vec<String>, _>(formats::FileList) {
            log::info!("!!! [RUST] Captured {} paths from clipboard", paths.len());
            return Ok(paths);
        }
    }
    Ok(Vec::new())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_drag::init())
        .manage(ThumbnailCache(std::sync::Mutex::new(lru::LruCache::new(
            std::num::NonZeroUsize::new(500).unwrap(),
        ))))
        .manage(ClipboardCache(std::sync::Mutex::new(None)))
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                log::info!("!!! [RUST] Window focused: {}", focused);
            }
        })
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            {
                use windows::Win32::Foundation::HWND;

                let hwnd = window.hwnd().unwrap();
                let whwnd = HWND(hwnd.0 as *mut _);

                // Create the drop overlay window (invisible until show_overlay is called)
                drop_overlay::create_drop_overlay(whwnd);
                println!("[SETUP] Drop overlay creation triggered");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_file_base64,
            show_item_properties,
            open_file,
            open_with,
            create_folder,
            delete_item,
            rename_item,
            copy_items,
            cut_items,
            paste_items,
            drop_items,
            move_items,
            delete_items,
            get_video_thumbnail,
            get_thumbnail,
            get_file_dimensions,
            get_system_default_paths,
            get_clipboard_info,
            get_dropped_file_paths,
            check_diagnostics,
            debug_window_hierarchy,
            get_recycle_bin_status,
            empty_recycle_bin,
            save_clipboard_image,
            open_terminal,
            resolve_shortcut,
            drop_overlay::show_overlay,
            drop_overlay::hide_overlay,
            extraction::extract_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
