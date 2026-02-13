use crate::{get_file_entry, DiskInfo, FileEntry};
use chrono::{DateTime, Local};
use rayon::prelude::*;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::{
    mpsc::{channel, Sender},
    OnceLock,
};
use std::thread;
use std::time::SystemTime;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
use windows::Win32::System::SystemServices::SFGAO_FLAGS;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_RecycleBinFolder, IEnumShellItems, IShellItem,
    SHCreateItemFromParsingName, SHFileOperationW, SHGetKnownFolderItem, FOF_ALLOWUNDO,
    FOF_MULTIDESTFILES, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_COPY, FO_MOVE,
    KF_FLAG_DEFAULT, SHFILEOPSTRUCTW, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
};

pub enum StaCommand {
    ListFiles {
        path: String,
        show_hidden: bool,
        response: Sender<Result<Vec<FileEntry>, String>>,
    },
    EmptyRecycleBin {
        response: Sender<Result<(), String>>,
    },
    DropItems {
        files: Vec<String>,
        target_path: String,
        response: Sender<Result<Vec<String>, String>>,
    },
    MoveItems {
        paths: Vec<String>,
        target_path: String,
        response: Sender<Result<(), String>>,
    },
}

pub struct StaWorker {
    sender: Sender<StaCommand>,
}

static WORKER: OnceLock<StaWorker> = OnceLock::new();

impl StaWorker {
    pub fn global() -> &'static StaWorker {
        WORKER.get_or_init(|| StaWorker::new())
    }

    fn new() -> Self {
        let (tx, rx) = channel();

        thread::spawn(move || {
            // CRITICAL: Initialize OLE for the STA thread
            // This is required for Windows Shell operations to work safely and support OLE Drag & Drop.
            unsafe {
                if let Err(e) = OleInitialize(None) {
                    log::error!("[STA-WORKER] OleInitialize FAILED: {:?}", e);
                    return;
                }
            }

            // Process commands
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    StaCommand::ListFiles {
                        path,
                        show_hidden,
                        response,
                    } => {
                        let result = list_files_impl(&path, show_hidden);
                        let _ = response.send(result);
                    }
                    StaCommand::EmptyRecycleBin { response } => {
                        let result = empty_recycle_bin_impl();
                        let _ = response.send(result);
                    }
                    StaCommand::DropItems {
                        files,
                        target_path,
                        response,
                    } => {
                        let result = drop_items_impl(files, target_path);
                        let _ = response.send(result);
                    }
                    StaCommand::MoveItems {
                        paths,
                        target_path,
                        response,
                    } => {
                        let result = move_items_impl(paths, target_path);
                        let _ = response.send(result);
                    }
                }
            }

            // Cleanup
            log::info!("[STA-WORKER] Worker thread shutting down.");
            unsafe { OleUninitialize() };
        });

        StaWorker { sender: tx }
    }

    pub fn list_files(&self, path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::ListFiles {
                path,
                show_hidden,
                response: tx,
            })
            .map_err(|e| format!("Failed to send command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive response from STA worker: {}", e))?
    }

    pub fn empty_recycle_bin(&self) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::EmptyRecycleBin { response: tx })
            .map_err(|e| format!("Failed to send command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive response from STA worker: {}", e))?
    }

    pub fn drop_items(
        &self,
        files: Vec<String>,
        target_path: String,
    ) -> Result<Vec<String>, String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::DropItems {
                files,
                target_path,
                response: tx,
            })
            .map_err(|e| format!("Failed to send drop command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive drop response from STA worker: {}", e))?
    }

    pub fn move_items(&self, paths: Vec<String>, target_path: String) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::MoveItems {
                paths,
                target_path,
                response: tx,
            })
            .map_err(|e| format!("Failed to send move command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive move response from STA worker: {}", e))?
    }
}

fn empty_recycle_bin_impl() -> Result<(), String> {
    use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOSOUND};
    unsafe {
        let result = SHEmptyRecycleBinW(
            Some(windows::Win32::Foundation::HWND(std::ptr::null_mut())),
            None,
            SHERB_NOCONFIRMATION | SHERB_NOSOUND,
        );

        if result.is_err() {
            return Err(format!("Failed to empty recycle bin: {:?}", result));
        }
    }
    Ok(())
}

// ==================================================================================
// MOVED IMPLEMENTATION (Private, running on STA thread)
// ==================================================================================

// get_file_entry imported from crate

fn list_recycle_bin() -> Result<Vec<FileEntry>, String> {
    let mut files = Vec::new();
    let now = SystemTime::now();
    let datetime: DateTime<Local> = now.into();
    let now_str = datetime.format("%d/%m/%Y %H:%M").to_string();

    unsafe {
        let bin_item: IShellItem =
            match SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None) {
                Ok(i) => i,
                Err(_) => {
                    return Err("Failed to get bin item".to_string());
                }
            };

        let enum_items: IEnumShellItems = match bin_item.BindToHandler(None, &BHID_EnumItems) {
            Ok(e) => e,
            Err(_) => {
                return Ok(files);
            }
        };

        let mut fetched = 0;
        let mut item_opt: [Option<IShellItem>; 1] = [None];

        while enum_items.Next(&mut item_opt, Some(&mut fetched)).is_ok() && fetched > 0 {
            if let Some(item) = item_opt[0].take() {
                let name = item
                    .GetDisplayName(SIGDN_NORMALDISPLAY)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| "Unknown".to_string());
                        CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| "Unknown".to_string());

                let path = item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| name.clone());
                        CoTaskMemFree(Some(p.as_ptr() as *const _));
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
                    modified_timestamp: 0,
                    dimensions: None,
                });
            }
        }
    }

    Ok(files)
}

fn list_files_impl(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    if path == "shell:RecycleBin" {
        return list_recycle_bin();
    }
    if path.is_empty() {
        let mut drives = Vec::new();
        let now = SystemTime::now();
        let datetime: DateTime<Local> = now.into();
        let created_at_str = datetime.format("%d/%m/%Y %H:%M").to_string();

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
                            total: total_number_of_bytes,
                            used: total_number_of_bytes - total_number_of_free_bytes,
                            free: total_number_of_free_bytes,
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
                    modified_timestamp: 0,
                    dimensions: None,
                });
            }
        }
        return Ok(drives);
    }

    let mut files = Vec::new();

    unsafe {
        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let item: IShellItem = match SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) {
            Ok(i) => i,
            Err(e) => {
                return Err(format!("Failed to access path: {}", e));
            }
        };

        let enum_items: IEnumShellItems = match item.BindToHandler(None, &BHID_EnumItems) {
            Ok(e) => e,
            Err(e) => {
                // If we can't enumerate, it might truly be access denied or an empty folder.
                return Err(format!("Access Denied or folder empty: {}", e));
            }
        };

        let mut fetched = 0;
        let mut item_opt: [Option<IShellItem>; 1] = [None];

        while enum_items.Next(&mut item_opt, Some(&mut fetched)).is_ok() && fetched > 0 {
            if let Some(child_item) = item_opt[0].take() {
                let name = child_item
                    .GetDisplayName(SIGDN_NORMALDISPLAY)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| "Unknown".to_string());
                        CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| "Unknown".to_string());

                let full_path = child_item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map(|p: PWSTR| {
                        let s = p.to_string().unwrap_or_else(|_| name.clone());
                        CoTaskMemFree(Some(p.as_ptr() as *const _));
                        s
                    })
                    .unwrap_or_else(|_| name.clone());

                let path_obj = std::path::Path::new(&full_path);

                if !show_hidden {
                    let hidden_flag = 0x80000; // SFGAO_HIDDEN
                    if let Ok(attr) = child_item.GetAttributes(SFGAO_FLAGS(hidden_flag)) {
                        if (attr.0 & hidden_flag) != 0 {
                            continue;
                        }
                    }
                }

                if let Ok(entry) = get_file_entry(path_obj) {
                    files.push(entry);
                } else {
                    files.push(FileEntry {
                        name,
                        path: full_path,
                        is_dir: false,
                        size: 0,
                        formatted_size: String::new(),
                        file_type: "System Item".to_string(),
                        created_at: "".to_string(),
                        modified_at: "".to_string(),
                        is_shortcut: false,
                        disk_info: None,
                        modified_timestamp: 0,
                        dimensions: None,
                    });
                }
            }
        }
    }

    files.par_sort_unstable_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            let a_chars = a.name.chars();
            let b_chars = b.name.chars();

            for (ac, bc) in a_chars.zip(b_chars) {
                let alc = ac.to_lowercase().next().unwrap();
                let blc = bc.to_lowercase().next().unwrap();
                if alc != blc {
                    return alc.cmp(&blc);
                }
            }
            a.name.len().cmp(&b.name.len())
        }
    });

    Ok(files)
}

fn drop_items_impl(files: Vec<String>, target_path: String) -> Result<Vec<String>, String> {
    log::info!(
        "[STA-WORKER] drop_items_impl called with {} files to {}",
        files.len(),
        target_path
    );

    let mut from_wide: Vec<u16> = Vec::new();
    let mut to_wide: Vec<u16> = Vec::new();
    let mut copied_paths: Vec<String> = Vec::new();

    for f in &files {
        from_wide.extend(OsStr::new(f).encode_wide());
        from_wide.push(0);

        let path_obj = std::path::Path::new(f);
        let filename = path_obj
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|| "unknown".into());

        // Calculate unique destination path to avoid overwrite
        let dest_path_buf = crate::get_next_available_path(&target_path, &filename);
        let dest_path_str = dest_path_buf.to_string_lossy().to_string();
        copied_paths.push(dest_path_str.clone());

        to_wide.extend(dest_path_buf.as_os_str().encode_wide());
        to_wide.push(0);
    }
    from_wide.push(0); // Double null termination
    to_wide.push(0); // Double null termination

    unsafe {
        let mut file_op = SHFILEOPSTRUCTW {
            hwnd: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            wFunc: FO_COPY,
            pFrom: PCWSTR(from_wide.as_ptr()),
            pTo: PCWSTR(to_wide.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 as u16)
                | (FOF_MULTIDESTFILES.0 as u16)
                | (FOF_SILENT.0 as u16)
                | (FOF_NOCONFIRMATION.0 as u16)
                | (FOF_NOERRORUI.0 as u16),
            fAnyOperationsAborted: windows::core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Copy failed with code: {}", result));
        }
    }
    Ok(copied_paths)
}

fn move_items_impl(paths: Vec<String>, target_path: String) -> Result<(), String> {
    log::info!(
        "[STA-WORKER] move_items_impl called with {} files to {}",
        paths.len(),
        target_path
    );

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
            fAnyOperationsAborted: windows::core::BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR(std::ptr::null()),
        };

        let result = SHFileOperationW(&mut file_op);
        if result != 0 {
            return Err(format!("Windows Move failed with code: {}", result));
        }

        if file_op.fAnyOperationsAborted.0 != 0 {
            return Err("Move aborted by user".to_string());
        }
    }
    Ok(())
}
