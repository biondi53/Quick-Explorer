use base64::prelude::*;
use chrono::{DateTime, Local};
use clipboard_win::{formats, Clipboard};
use rayon::prelude::*;
use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::time::SystemTime;
use tauri::Manager;
use window_vibrancy::apply_mica;
use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED, STGM};
use windows::Win32::System::DataExchange::{
    EmptyClipboard, GetClipboardSequenceNumber, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_RecycleBinFolder, IEnumShellItems, IShellItem, IShellItemImageFactory,
    SHCreateItemFromParsingName, SHEmptyRecycleBinW, SHFileOperationW, SHGetKnownFolderItem,
    SHQueryRecycleBinW, FOF_ALLOWUNDO, FOF_MULTIDESTFILES, FO_COPY, FO_DELETE, FO_MOVE, FO_RENAME,
    KF_FLAG_DEFAULT, SHERB_NOCONFIRMATION, SHERB_NOSOUND, SHFILEOPSTRUCTW, SHQUERYRBINFO,
    SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY, SIIGBF_ICONONLY, SIIGBF_THUMBNAILONLY,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
struct ClipboardInfo {
    has_files: bool,
    paths: Vec<String>,
    is_cut: bool,
    file_count: usize,
    file_summary: Option<String>,
    has_image: bool,
    image_data: Option<String>, // Base64 Data URI
}

struct ClipboardCache(std::sync::Mutex<Option<(u32, ClipboardInfo)>>);

#[derive(Serialize, Clone)]
struct DiskInfo {
    total_space: u64,
    available_space: u64,
}

#[derive(Serialize, Default, Clone)]
struct RecycleBinStatus {
    is_empty: bool,
    item_count: i64,
    total_size: i64,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    formatted_size: String,
    file_type: String,
    created_at: String,
    modified_at: String,
    is_shortcut: bool,
    disk_info: Option<DiskInfo>,
}

#[cfg(windows)]
fn is_hidden(path: &std::path::Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    if let Ok(metadata) = std::fs::metadata(path) {
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        return (metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN) != 0;
    }
    false
}

#[cfg(not(windows))]
fn is_hidden(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

fn get_file_entry(path: &std::path::Path) -> Result<FileEntry, String> {
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
    })
}

fn list_recycle_bin() -> Result<Vec<FileEntry>, String> {
    let mut files = Vec::new();
    let now = SystemTime::now();
    let datetime: DateTime<Local> = now.into();
    let now_str = datetime.format("%d/%m/%Y %H:%M").to_string();

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let bin_item: IShellItem =
            match SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None) {
                Ok(i) => i,
                Err(_) => {
                    CoUninitialize();
                    return Err("Failed to get bin item".to_string());
                }
            };

        let enum_items: IEnumShellItems = match bin_item.BindToHandler(None, &BHID_EnumItems) {
            Ok(e) => e,
            Err(_) => {
                CoUninitialize();
                return Ok(files);
            }
        };

        let mut fetched = 0;
        let mut item_opt = [None];

        while enum_items.Next(&mut item_opt, Some(&mut fetched)).is_ok() && fetched > 0 {
            if let Some(item) = item_opt[0].take() {
                let name = item
                    .GetDisplayName(SIGDN_NORMALDISPLAY)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| "Unknown".to_string());
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| "Unknown".to_string());

                let path = item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| name.clone());
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| name.clone());

                files.push(FileEntry {
                    name,
                    path,
                    is_dir: false,
                    size: 0,
                    formatted_size: String::new(),
                    file_type: "Deleted Item".to_string(),
                    created_at: now_str.clone(),
                    modified_at: now_str.clone(),
                    is_shortcut: false,
                    disk_info: None,
                });
            }
        }

        CoUninitialize();
    }

    Ok(files)
}

#[tauri::command]
fn list_files(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    if path == "shell:RecycleBin" {
        return list_recycle_bin();
    }
    if path.is_empty() {
        let mut drives = Vec::new();
        let now = SystemTime::now();
        let datetime: DateTime<Local> = now.into();
        let created_at_str = datetime.format("%d/%m/%Y %H:%M").to_string();

        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        for b in b'C'..=b'Z' {
            let drive_letter = b as char;
            let drive_path = format!("{}:\\", drive_letter);
            if std::path::Path::new(&drive_path).exists() {
                let mut free_bytes_available = 0u64;
                let mut total_number_of_bytes = 0u64;
                let mut total_number_of_free_bytes = 0u64;

                let path_wide: Vec<u16> = OsStr::new(&drive_path)
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();

                let disk_info = unsafe {
                    if GetDiskFreeSpaceExW(
                        PCWSTR(path_wide.as_ptr()),
                        Some(&mut free_bytes_available),
                        Some(&mut total_number_of_bytes),
                        Some(&mut total_number_of_free_bytes),
                    )
                    .is_ok()
                    {
                        Some(DiskInfo {
                            total_space: total_number_of_bytes,
                            available_space: total_number_of_free_bytes,
                        })
                    } else {
                        None
                    }
                };

                drives.push(FileEntry {
                    name: format!("Local Disk ({}:)", drive_letter),
                    path: drive_path,
                    is_dir: true,
                    size: 0,
                    formatted_size: String::new(),
                    file_type: "Drive".to_string(),
                    created_at: created_at_str.clone(),
                    modified_at: created_at_str.clone(),
                    is_shortcut: false,
                    disk_info,
                });
            }
        }
        return Ok(drives);
    }

    let mut files = Vec::new();

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let item: IShellItem = match SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) {
            Ok(i) => i,
            Err(e) => {
                CoUninitialize();
                return Err(format!("Failed to access path: {}", e));
            }
        };

        // Bind to the enum handler. This handles junctions and restricted folders much better than read_dir.
        let enum_items: IEnumShellItems = match item.BindToHandler(None, &BHID_EnumItems) {
            Ok(e) => e,
            Err(e) => {
                CoUninitialize();
                // If we can't enumerate, it might truly be access denied or an empty folder.
                return Err(format!("Access Denied or folder empty: {}", e));
            }
        };

        let mut fetched = 0;
        let mut item_opt = [None];

        while enum_items.Next(&mut item_opt, Some(&mut fetched)).is_ok() && fetched > 0 {
            if let Some(child_item) = item_opt[0].take() {
                let name = child_item
                    .GetDisplayName(SIGDN_NORMALDISPLAY)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| "Unknown".to_string());
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| "Unknown".to_string());

                let full_path = child_item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| name.clone());
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| name.clone());

                let path_obj = std::path::Path::new(&full_path);

                if !show_hidden && is_hidden(path_obj) {
                    continue;
                }

                if let Ok(entry) = get_file_entry(path_obj) {
                    files.push(entry);
                } else {
                    // Fallback for items that get_file_entry might fail on (like some system items)
                    files.push(FileEntry {
                        name,
                        path: full_path,
                        is_dir: false, // Default to false if we can't tell, or use Shell attributes
                        size: 0,
                        formatted_size: String::new(),
                        file_type: "System Item".to_string(),
                        created_at: "".to_string(),
                        modified_at: "".to_string(),
                        is_shortcut: false,
                        disk_info: None,
                    });
                }
            }
        }

        CoUninitialize();
    }

    files.par_sort_unstable_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(files)
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
            Win32::Foundation::HWND,
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
            hwnd: HWND(std::ptr::null_mut()),
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
                    windows::Win32::Foundation::HWND(std::ptr::null_mut()),
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
            Win32::Foundation::HWND,
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
            hwnd: HWND(std::ptr::null_mut()),
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
            fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
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
            fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
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

        SetClipboardData(15, HANDLE(h_global.0 as *mut _)).map_err(|e| e.to_string())?;
    }

    let format_id = clipboard_win::register_format("Preferred DropEffect")
        .ok_or("Failed to register format")?;

    let effect_bytes = effect.to_ne_bytes().to_vec();
    let size_effect = effect_bytes.len();

    unsafe {
        let h_global = GlobalAlloc(GMEM_MOVEABLE, size_effect).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(h_global);
        std::ptr::copy_nonoverlapping(effect_bytes.as_ptr(), ptr as *mut u8, size_effect);
        let _ = GlobalUnlock(h_global);

        SetClipboardData(format_id.get(), HANDLE(h_global.0 as *mut _))
            .map_err(|e| e.to_string())?;
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
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        };
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

        unsafe {
            let _ = CoInitialize(None);

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

fn get_next_available_path(target_dir: &str, original_name: &str) -> std::path::PathBuf {
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
                                    windows::Win32::Foundation::HWND(std::ptr::null_mut()),
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
            fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
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

            unsafe {
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

#[tauri::command]
fn move_items(paths: Vec<String>, target_path: String) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let mut from_wide: Vec<u16> = Vec::new();
    for f in &paths {
        from_wide.extend(OsStr::new(f).encode_wide());
        from_wide.push(0);
    }
    from_wide.push(0);

    let mut to_wide: Vec<u16> = OsStr::new(&target_path).encode_wide().collect();
    to_wide.push(0);
    to_wide.push(0);

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_MOVE,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(to_wide.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 as u16),
            fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);

        CoUninitialize();

        if result != 0 {
            return Err(format!("Windows Move failed with code: {}", result));
        }

        if file_op.fAnyOperationsAborted.0 != 0 {
            return Err("Move aborted by user".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_items(paths: Vec<String>) -> Result<(), String> {
    let mut from_wide: Vec<u16> = Vec::new();
    for f in &paths {
        from_wide.extend(OsStr::new(f).encode_wide());
        from_wide.push(0);
    }
    from_wide.push(0);

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(std::ptr::null()),
            fFlags: (FOF_ALLOWUNDO.0 as u16),
            fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
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

struct ThumbnailCache(std::sync::Mutex<lru::LruCache<String, String>>);

#[tauri::command]
async fn get_video_thumbnail(
    path: String,
    state: tauri::State<'_, ThumbnailCache>,
) -> Result<String, String> {
    {
        let mut cache = state.0.lock().unwrap();
        if let Some(data) = cache.get(&path) {
            return Ok(data.clone());
        }
    }

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

    {
        let mut cache = state.0.lock().unwrap();
        cache.put(path, data_uri.clone());
    }

    Ok(data_uri)
}

fn generate_shell_thumbnail(path: &str, size: u32) -> Result<String, String> {
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let shell_item: IShellItemImageFactory =
            match SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) {
                Ok(si) => si,
                Err(_) => {
                    CoUninitialize();
                    return Err("Failed to create shell item".to_string());
                }
            };

        let thumb_size = SIZE {
            cx: size as i32,
            cy: size as i32,
        };

        let hbitmap = if let Ok(h) = shell_item.GetImage(thumb_size, SIIGBF_THUMBNAILONLY) {
            h
        } else if let Ok(h) = shell_item.GetImage(thumb_size, SIIGBF_ICONONLY) {
            h
        } else {
            CoUninitialize();
            return Err("Failed to get image".to_string());
        };

        let mut bmp = BITMAP::default();
        let result = GetObjectW(
            hbitmap,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );

        if result == 0 {
            let _ = DeleteObject(hbitmap);
            CoUninitialize();
            return Err("Failed to get bitmap info".to_string());
        }

        let width = bmp.bmWidth as u32;
        let height = bmp.bmHeight as u32;

        let hdc = CreateCompatibleDC(None);
        let old_bitmap = SelectObject(hdc, hbitmap);

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
            hbitmap,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc, old_bitmap);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbitmap);
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
        Ok(format!("data:image/jpeg;base64,{}", base64_data))
    }
}

#[tauri::command]
async fn get_thumbnail(
    path: String,
    size: u32,
    state: tauri::State<'_, ThumbnailCache>,
) -> Result<String, String> {
    let cache_key = format!("{}:{}", path, size);

    {
        let mut cache = state.0.lock().unwrap();
        if let Some(data) = cache.get(&cache_key) {
            return Ok(data.clone());
        }
    }

    let path_clone = path.clone();
    let data_uri = tokio::task::spawn_blocking(move || generate_shell_thumbnail(&path_clone, size))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    {
        let mut cache = state.0.lock().unwrap();
        cache.put(cache_key, data_uri.clone());
    }

    Ok(data_uri)
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
                if let Ok(data_uri) = generate_shell_thumbnail(&paths[0], 1200) {
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
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result = SHEmptyRecycleBinW(
            windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            PCWSTR(std::ptr::null()),
            SHERB_NOCONFIRMATION | SHERB_NOSOUND,
        );
        CoUninitialize();

        if result.is_err() {
            return Err(format!("Failed to empty recycle bin: {:?}", result));
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(ThumbnailCache(std::sync::Mutex::new(lru::LruCache::new(
            std::num::NonZeroUsize::new(500).unwrap(),
        ))))
        .manage(ClipboardCache(std::sync::Mutex::new(None)))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            #[cfg(target_os = "windows")]
            {
                let _ = apply_mica(&window, None);

                // Disable system menu via Style (First layer)
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
            move_items,
            get_clipboard_info,
            delete_items,
            get_video_thumbnail,
            get_thumbnail,
            get_system_default_paths,
            save_clipboard_image,
            open_terminal,
            resolve_shortcut,
            empty_recycle_bin,
            get_recycle_bin_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
