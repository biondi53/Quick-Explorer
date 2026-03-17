use crate::{DiskInfo, FileEntry};
use base64::{engine::general_purpose, Engine as _};
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
use tauri::Emitter;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
use windows::Win32::System::SystemServices::{SFGAO_FLAGS, SFGAO_FOLDER};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetActiveWindow, GetAsyncKeyState, GetFocus, IsWindowEnabled, SetActiveWindow, VK_LBUTTON,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_RecycleBinFolder, FileOperation, IEnumShellItems, IFileOperation,
    ILFree, ILGetSize, IShellItem, SHCreateItemFromIDList, SHCreateItemFromParsingName,
    SHGetIDListFromObject, SHGetKnownFolderItem, FOF_ALLOWUNDO, FOF_NOCONFIRMMKDIR,
    FOF_RENAMEONCOLLISION, KF_FLAG_DEFAULT, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, GetClassNameW, GetForegroundWindow,
    GetWindowThreadProcessId, IsWindowVisible, SendMessageW, SetForegroundWindow, WM_NULL,
};

struct ThreadInputGuard {
    target_thread_id: u32,
    attached: bool,
}

impl ThreadInputGuard {
    fn new(hwnd_input: windows::Win32::Foundation::HWND) -> Self {
        let hwnd = hwnd_input; // No need to find root here, just need a window on the UI thread

        let mut target_thread_id = 0;
        if !hwnd.0.is_null() {
            target_thread_id = unsafe { GetWindowThreadProcessId(hwnd, None) };
        }

        let current_thread_id = unsafe { GetCurrentThreadId() };
        let mut attached = false;

        if target_thread_id != 0 && target_thread_id != current_thread_id {
            unsafe {
                if AttachThreadInput(current_thread_id, target_thread_id, true).as_bool() {
                    attached = true;
                    log::debug!(
                        "[STA-WORKER] Attached thread input: {} -> {}",
                        current_thread_id,
                        target_thread_id
                    );
                }
            }
        }

        Self {
            target_thread_id,
            attached,
        }
    }
}

impl Drop for ThreadInputGuard {
    fn drop(&mut self) {
        if self.attached {
            let current_thread_id = unsafe { GetCurrentThreadId() };
            unsafe {
                let _ = AttachThreadInput(current_thread_id, self.target_thread_id, false);
                log::debug!("[STA-WORKER] Detached thread input");
            }
        }
    }
}

/// v11.2 "Absolute State Lockdown": Sincronización determinista físico-lógica.
/// Supera el limbo 'Active: 0x0' mediante re-intentos de estado completo.
fn synchronize_handshake(hwnd: windows::Win32::Foundation::HWND) {
    use std::time::{Duration, Instant};

    if hwnd.0.is_null() {
        return;
    }

    let start = Instant::now();
    unsafe {
        // 1. Hardware Sync: Esperar a que el usuario suelte físicamente el mouse.
        while (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 {
            if start.elapsed() > Duration::from_millis(500) {
                break;
            }
            thread::yield_now();
        }

        // 2. Queue Handshake: WM_NULL bloqueante para vaciar la cola del hilo UI.
        let _ = SendMessageW(hwnd, WM_NULL, None, None);

        // 3. ABSOLUTE STATE LOCKDOWN (v11.2):
        // No basta con ser Foreground; el hilo debe estar Active (no 0x0).
        // Insistimos hasta que ambos estados coincidan.
        let mut attempts = 0;
        while attempts < 100 {
            let _ = AllowSetForegroundWindow(0xFFFFFFFF);
            let _ = BringWindowToTop(hwnd);
            let _ = SetActiveWindow(hwnd);
            let _ = SetForegroundWindow(hwnd);

            let fg = GetForegroundWindow();
            let act = GetActiveWindow();

            // Sincronización perfecta lograda
            if fg == hwnd && act == hwnd {
                if attempts > 0 {
                    log::debug!(
                        "[STA-WORKER] Handshake LOCKDOWN stabilized at attempt {}",
                        attempts
                    );
                }
                break;
            }

            // Si estamos en el limbo (Foreground ok, pero Active 0), pausamos brevemente
            thread::sleep(Duration::from_millis(5));
            attempts += 1;
        }

        // 4. Final Permission: Asegurar permiso para el Shell justo antes de PerformOperations.
        let _ = AllowSetForegroundWindow(0xFFFFFFFF);

        log::debug!(
            "[STA-WORKER] Handshake SYNC v12.0 (Out-of-Band) completed in {:?}",
            start.elapsed()
        );
    }
}

fn notify_refresh() {
    if let Some(app) = crate::APP_HANDLE.get() {
        let _ = app.emit("refresh-tab", ());
        log::debug!("[STA-WORKER] Event 'refresh-tab' emitted.");
    }
}

fn log_sta_diagnostic(label: &str, target_hwnd: windows::Win32::Foundation::HWND) {
    unsafe {
        let fg = GetForegroundWindow();
        let active = GetActiveWindow();
        let focus = GetFocus();
        let is_visible = IsWindowVisible(target_hwnd).as_bool();
        let is_enabled = IsWindowEnabled(target_hwnd).as_bool();

        let mut class_name = [0u16; 256];
        let len = GetClassNameW(fg, &mut class_name);
        let fg_class = String::from_utf16_lossy(&class_name[..len as usize]);

        log::debug!(
            "[DIAGNOSTICS - STA] [{}] \n\
             - Target HWND: {:?} (Visible: {}, Enabled: {})\n\
             - Foreground: {:?} (Class: {})\n\
             - Active: {:?}, Focus: {:?}",
            label,
            target_hwnd,
            is_visible,
            is_enabled,
            fg,
            fg_class,
            active,
            focus
        );
    }
}

pub enum StaCommand {
    ListFiles {
        path: String,
        show_hidden: bool,
        nav_id: Option<String>,
        response: Sender<Result<Vec<FileEntry>, String>>,
    },
    EmptyRecycleBin {
        response: Sender<Result<(), String>>,
    },
    DropItems {
        files: Vec<String>,
        target_path: String,
        hwnd: Option<isize>,
        response: Sender<Result<Vec<String>, String>>,
    },
    MoveItems {
        paths: Vec<String>,
        target_path: String,
        hwnd: Option<isize>,
        response: Sender<Result<(), String>>,
    },
    DeleteItems {
        paths: Vec<String>,
        hwnd: Option<isize>,
        response: Sender<Result<(), String>>,
    },
    RenameItem {
        path: String,
        new_name: String,
        hwnd: Option<isize>,
        response: Sender<Result<(), String>>,
    },
    PasteItems {
        paths: Vec<String>,
        target_path: String,
        is_move: bool,
        hwnd: Option<isize>,
        response: Sender<Result<Vec<String>, String>>,
    },
    RestoreItems {
        paths: Vec<String>,
        response: Sender<Result<(), String>>,
    },
    RecursiveSearch {
        path: String,
        query: String,
        nav_id: String,
        window: tauri::Window,
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
                        nav_id,
                        response,
                    } => {
                        let result = list_items_impl(&path, show_hidden, nav_id);
                        let _ = response.send(result);
                    }
                    StaCommand::EmptyRecycleBin { response } => {
                        let result = empty_recycle_bin_impl();
                        let _ = response.send(result);
                    }
                    StaCommand::DropItems {
                        files,
                        target_path,
                        hwnd,
                        response,
                    } => {
                        let result = drop_items_impl(files, target_path, hwnd);
                        let _ = response.send(result);
                    }
                    StaCommand::MoveItems {
                        paths,
                        target_path,
                        hwnd,
                        response,
                    } => {
                        let result = move_items_impl(paths, target_path, hwnd);
                        let _ = response.send(result);
                    }
                    StaCommand::DeleteItems {
                        paths,
                        hwnd,
                        response,
                    } => {
                        let result = delete_items_impl(paths, hwnd);
                        let _ = response.send(result);
                    }
                    StaCommand::RenameItem {
                        path,
                        new_name,
                        hwnd,
                        response,
                    } => {
                        let result = rename_item_impl(path, new_name, hwnd);
                        let _ = response.send(result);
                    }
                    StaCommand::PasteItems {
                        paths,
                        target_path,
                        is_move,
                        hwnd,
                        response,
                    } => {
                        let result = paste_items_impl(paths, target_path, is_move, hwnd);
                        let _ = response.send(result);
                    }
                    StaCommand::RestoreItems { paths, response } => {
                        let result = restore_items_impl(paths);
                        let _ = response.send(result);
                    }
                    StaCommand::RecursiveSearch {
                        path,
                        query,
                        nav_id,
                        window,
                        response,
                    } => {
                        let result = recursive_search_impl(path, query, nav_id, window);
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

    pub fn list_files(
        &self,
        path: String,
        show_hidden: bool,
        nav_id: Option<String>,
    ) -> Result<Vec<FileEntry>, String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::ListFiles {
                path,
                show_hidden,
                nav_id,
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
        hwnd: Option<isize>,
    ) -> Result<Vec<String>, String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::DropItems {
                files,
                target_path,
                hwnd,
                response: tx,
            })
            .map_err(|e| format!("Failed to send drop command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive drop response from STA worker: {}", e))?
    }

    pub fn move_items(
        &self,
        paths: Vec<String>,
        target_path: String,
        hwnd: Option<isize>,
    ) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::MoveItems {
                paths,
                target_path,
                hwnd,
                response: tx,
            })
            .map_err(|e| format!("Failed to send move command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive move response from STA worker: {}", e))?
    }

    pub fn delete_items(&self, paths: Vec<String>, hwnd: Option<isize>) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::DeleteItems {
                paths,
                hwnd,
                response: tx,
            })
            .map_err(|e| format!("Failed to send delete command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive delete response from STA worker: {}", e))?
    }

    pub fn rename_item(
        &self,
        path: String,
        new_name: String,
        hwnd: Option<isize>,
    ) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::RenameItem {
                path,
                new_name,
                hwnd,
                response: tx,
            })
            .map_err(|e| format!("Failed to send rename command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive rename response from STA worker: {}", e))?
    }

    pub fn paste_items(
        &self,
        paths: Vec<String>,
        target_path: String,
        is_move: bool,
        hwnd: Option<isize>,
    ) -> Result<Vec<String>, String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::PasteItems {
                paths,
                target_path,
                is_move,
                hwnd,
                response: tx,
            })
            .map_err(|e| format!("Failed to send paste command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive paste response from STA worker: {}", e))?
    }

    pub fn restore_items(&self, paths: Vec<String>) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::RestoreItems {
                paths,
                response: tx,
            })
            .map_err(|e| format!("Failed to send restore command to STA worker: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive restore response from STA worker: {}", e))?
    }

    pub async fn recursive_search(
        &self,
        path: String,
        query: String,
        nav_id: String,
        window: tauri::Window,
    ) -> Result<(), String> {
        let (tx, rx) = channel();
        self.sender
            .send(StaCommand::RecursiveSearch {
                path,
                query,
                nav_id,
                window,
                response: tx,
            })
            .map_err(|e| format!("Failed to send recursive search command: {}", e))?;

        rx.recv()
            .map_err(|e| format!("Failed to receive recursive search response: {}", e))?
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

fn create_shell_item(path: &str) -> Result<IShellItem, windows::core::Error> {
    unsafe {
        if path.len() > 100 && !path.contains('\\') && !path.contains(':') {
            // Likely a Base64 encoded PIDL (Recycle Bin item)
            if let Ok(pidl_bytes) = general_purpose::STANDARD.decode(path) {
                return SHCreateItemFromIDList(pidl_bytes.as_ptr() as *const ITEMIDLIST);
            }
        }

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None)
    }
}

fn restore_items_impl(paths: Vec<String>) -> Result<(), String> {
    use windows::core::PCSTR;
    use windows::Win32::UI::Shell::{BHID_SFUIObject, IContextMenu, CMINVOKECOMMANDINFO};

    unsafe {
        for path_encoded in paths {
            let item: IShellItem = match create_shell_item(&path_encoded) {
                Ok(i) => i,
                Err(e) => {
                    log::warn!(
                        "[STA-WORKER] Failed to create shell item for restore: {}",
                        e
                    );
                    continue;
                }
            };

            // Bind to IContextMenu to access the "undelete" (restore) verb
            let context_menu: IContextMenu = match item.BindToHandler(None, &BHID_SFUIObject) {
                Ok(cm) => cm,
                Err(e) => {
                    log::warn!(
                        "[STA-WORKER] Failed to bind to IContextMenu for restore: {}",
                        e
                    );
                    continue;
                }
            };

            // Use "undelete" as the canonical verb for restoring from Recycle Bin
            let verb = "undelete\0";
            let info = CMINVOKECOMMANDINFO {
                cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                lpVerb: PCSTR(verb.as_ptr()),
                nShow: windows::Win32::UI::WindowsAndMessaging::SW_HIDE.0 as i32,
                ..Default::default()
            };

            if let Err(e) = context_menu.InvokeCommand(&info) {
                log::warn!("[STA-WORKER] InvokeCommand(undelete) failed: {}", e);
            }
        }
    }

    notify_refresh();
    Ok(())
}

// ==================================================================================
// MOVED IMPLEMENTATION (Private, running on STA thread)
// ==================================================================================

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

                // Use Base64 encoded PIDL as the path identifier.
                // This is the only unique and reliable way to identify Recycle Bin items.
                let path = if let Ok(pidl) = SHGetIDListFromObject(&item) {
                    let size = ILGetSize(Some(pidl as *const ITEMIDLIST));
                    let pidl_slice = std::slice::from_raw_parts(pidl as *const u8, size as usize);
                    let encoded = general_purpose::STANDARD.encode(pidl_slice);
                    ILFree(Some(pidl as *const ITEMIDLIST));
                    encoded
                } else {
                    name.clone()
                };

                let mut is_dir = false;
                let mut file_type = "Deleted Item".to_string();

                if let Ok(attr) = item.GetAttributes(SFGAO_FOLDER) {
                    if (attr.0 & SFGAO_FOLDER.0) != 0 {
                        is_dir = true;
                        file_type = "Deleted Folder".to_string();
                    }
                }

                files.push(FileEntry {
                    name,
                    path,
                    is_dir,
                    size: 0,
                    formatted_size: String::new(),
                    file_type,
                    created_at: now_str.clone(),
                    modified_at: now_str.clone(),
                    is_shortcut: false,
                    disk_info: None,
                    modified_timestamp: 0,
                    created_timestamp: 0,
                    dimensions: None,
                });
            }
        }
    }

    Ok(files)
}

fn get_localized_name(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "downloads" => "Descargas".to_string(),
        "documents" => "Documentos".to_string(),
        "pictures" => "Imágenes".to_string(),
        "music" => "Música".to_string(),
        "videos" => "Vídeos".to_string(),
        "desktop" => "Escritorio".to_string(),
        "favorites" => "Favoritos".to_string(),
        "contacts" => "Contactos".to_string(),
        "links" => "Vínculos".to_string(),
        "searches" => "Búsquedas".to_string(),
        "saved games" => "Juegos guardados".to_string(),
        "3d objects" => "Objetos 3D".to_string(),
        _ => name.to_string(),
    }
}

fn list_files_native(
    path: &str,
    show_hidden: bool,
    nav_id: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let is_cancelled = || {
        if let Some(id) = &nav_id {
            if let Some(mutex) = crate::GLOBAL_NAV_ID.get() {
                if let Ok(current_id) = mutex.lock() {
                    return *current_id != *id;
                }
            }
        }
        false
    };

    let mut entries_vec = Vec::new();
    for e in entries {
        if is_cancelled() {
            log::debug!("[STA-WORKER] Native read cancelled by navigation change (nav_id {:?})", nav_id);
            break;
        }
        if let Ok(entry) = e {
            entries_vec.push(entry);
        }
    }

    let files: Vec<FileEntry> = entries_vec
        .into_par_iter()
        .filter_map(|entry| {
            let path_obj = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let full_path = path_obj.to_string_lossy().to_string();

            if !show_hidden {
                // On Windows, check file attributes for hidden flag
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if let Ok(metadata) = entry.metadata() {
                        let attrs = metadata.file_attributes();
                        if (attrs & 0x2) != 0 {
                            // 0x2 is FILE_ATTRIBUTE_HIDDEN
                            return None;
                        }
                    }
                }
            }

            if let Ok(metadata) = entry.metadata() {
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

                let extension = path_obj
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let is_shortcut = extension == "lnk";

                let file_type = if is_shortcut {
                    "Shortcut".to_string()
                } else if is_dir {
                    "Folder".to_string()
                } else {
                    path_obj
                        .extension()
                        .map(|ext| ext.to_string_lossy().to_uppercase() + " File")
                        .unwrap_or_else(|| "File".to_string())
                };

                let created_at = metadata.created().unwrap_or_else(|_| SystemTime::now());
                let created_datetime: DateTime<Local> = created_at.into();
                let created_at_str = created_datetime.format("%d/%m/%Y %H:%M").to_string();

                let modified_at = metadata.modified().unwrap_or_else(|_| SystemTime::now());
                let modified_datetime: DateTime<Local> = modified_at.into();
                let modified_at_str = modified_datetime.format("%d/%m/%Y %H:%M").to_string();

                Some(FileEntry {
                    name: get_localized_name(&name),
                    path: full_path,
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
                    created_timestamp: created_at
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64,
                    dimensions: None,
                })
            } else {
                Some(FileEntry {
                    name: get_localized_name(&name),
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
                    created_timestamp: 0,
                    dimensions: None,
                })
            }
        })
        .collect();

    Ok(files)
}

fn list_items_impl(
    path: &str,
    show_hidden: bool,
    nav_id: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    log::debug!("[STA-WORKER] list_items_impl called for path: {}", path);

    let is_cancelled = || {
        if let Some(id) = &nav_id {
            let mutex = crate::GLOBAL_NAV_ID.get_or_init(|| std::sync::Mutex::new(String::new()));
            if let Ok(current_id) = mutex.lock() {
                return *current_id != *id;
            }
        }
        false
    };

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

                let system_drive = std::env::var("SystemDrive")
                    .unwrap_or_else(|_| "C:".to_string())
                    .to_uppercase();
                let is_system = drive_path.starts_with(&system_drive);

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
                            is_system,
                            is_ssd: crate::is_ssd(&drive_path),
                        })
                    } else {
                        None
                    }
                };

                // Get Custom Volume Label
                let mut volume_name_buffer: [u16; windows::Win32::Foundation::MAX_PATH as usize
                    + 1] = [0; windows::Win32::Foundation::MAX_PATH as usize + 1];
                let mut display_name = format!("Local Disk ({}:)", drive_letter);

                unsafe {
                    if windows::Win32::Storage::FileSystem::GetVolumeInformationW(
                        PCWSTR(path_wide.as_ptr()),
                        Some(&mut volume_name_buffer),
                        None,
                        None,
                        None,
                        None,
                    )
                    .is_ok()
                    {
                        let vol_name = String::from_utf16_lossy(&volume_name_buffer)
                            .trim_matches(char::from(0))
                            .to_string();

                        if !vol_name.is_empty() {
                            display_name = format!("{} ({}:)", vol_name, drive_letter);
                        }
                    }
                }

                drives.push(FileEntry {
                    name: display_name,
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
                    created_timestamp: 0,
                    dimensions: None,
                });
            }
        }
        return Ok(drives);
    }

    if path.is_empty() {
        // ... drives logic exists ... (already correctly handled above)
    }

    // LEVEL 1 OPTIMIZATION: Bifurcation
    // If it's a normal absolute path on disk, use the high-performance native reader.
    let path_obj = std::path::Path::new(path);
    if path_obj.is_absolute() && path_obj.exists() {
        return list_files_native(path, show_hidden, nav_id);
    }

    // Fallback: Shell API (IShellItem) for virtual folders, drives, etc.
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
            if is_cancelled() {
                break;
            }
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

                // Build FileEntry inline — avoids the redundant disk read
                // that get_file_entry(path) would cause via path.metadata().
                if let Ok(metadata) = path_obj.metadata() {
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

                    let extension = path_obj
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let is_shortcut = extension == "lnk";

                    let file_type = if is_shortcut {
                        "Shortcut".to_string()
                    } else if is_dir {
                        "Folder".to_string()
                    } else {
                        path_obj
                            .extension()
                            .map(|ext| ext.to_string_lossy().to_uppercase() + " File")
                            .unwrap_or_else(|| "File".to_string())
                    };

                    let created_at = metadata.created().unwrap_or_else(|_| SystemTime::now());
                    let created_datetime: DateTime<Local> = created_at.into();
                    let created_at_str = created_datetime.format("%d/%m/%Y %H:%M").to_string();

                    let modified_at = metadata.modified().unwrap_or_else(|_| SystemTime::now());
                    let modified_datetime: DateTime<Local> = modified_at.into();
                    let modified_at_str = modified_datetime.format("%d/%m/%Y %H:%M").to_string();

                    files.push(FileEntry {
                        name,
                        path: full_path,
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
                        created_timestamp: created_at
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64,
                        dimensions: None,
                    });
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
                        created_timestamp: 0,
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

fn drop_items_impl(
    files: Vec<String>,
    target_path: String,
    hwnd: Option<isize>,
) -> Result<Vec<String>, String> {
    log::debug!(
        "[STA-WORKER] drop_items_impl (IFileOperation) called with {} files to {}",
        files.len(),
        target_path
    );

    unsafe {
        let file_op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create IFileOperation: {}", e))?;

        let _ =
            file_op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR);

        // --- LIFETIME EXTENSION (v8.1) ---
        // Declare the guard at the function level so it lives through PerformOperations()
        let mut _input_guard: Option<ThreadInputGuard> = None;
        let mut hwnd_win = windows::Win32::Foundation::HWND::default();

        if let Some(h) = hwnd {
            hwnd_win = windows::Win32::Foundation::HWND(h as *mut _);
            log_sta_diagnostic("BEFORE PerformOperations (Drop)", hwnd_win);
            _input_guard = Some(ThreadInputGuard::new(hwnd_win));
            let _ = file_op.SetOwnerWindow(hwnd_win);
        }

        let dest_item: IShellItem = create_shell_item(&target_path)
            .map_err(|e| format!("Failed to create destination item: {}", e))?;

        for f in &files {
            if let Ok(item) = create_shell_item(f) {
                let _ = file_op.CopyItem(&item, &dest_item, PCWSTR(std::ptr::null()), None);
            }
        }

        // HANDSHAKE v11.0 (STA Sync)
        if !hwnd_win.0.is_null() {
            synchronize_handshake(hwnd_win);
        }

        file_op
            .PerformOperations()
            .map_err(|e| format!("PerformOperations failed: {}", e))?;
        notify_refresh();
    }

    Ok(Vec::new())
}

fn move_items_impl(
    paths: Vec<String>,
    target_path: String,
    hwnd: Option<isize>,
) -> Result<(), String> {
    log::debug!(
        "[STA-WORKER] move_items_impl (IFileOperation) called with {} files to {}",
        paths.len(),
        target_path
    );

    unsafe {
        let file_op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create IFileOperation: {}", e))?;

        let _ =
            file_op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR);

        // --- LIFETIME EXTENSION (v8.1) ---
        let mut _input_guard: Option<ThreadInputGuard> = None;
        let mut hwnd_win = windows::Win32::Foundation::HWND::default();

        if let Some(h) = hwnd {
            hwnd_win = windows::Win32::Foundation::HWND(h as *mut _);
            log_sta_diagnostic("BEFORE PerformOperations (Move)", hwnd_win);
            _input_guard = Some(ThreadInputGuard::new(hwnd_win));
            let _ = file_op.SetOwnerWindow(hwnd_win);
        }

        let dest_item: IShellItem = create_shell_item(&target_path)
            .map_err(|e| format!("Failed to create destination item: {}", e))?;

        for f in &paths {
            if let Ok(item) = create_shell_item(f) {
                let _ = file_op.MoveItem(&item, &dest_item, PCWSTR(std::ptr::null()), None);
            }
        }

        // HANDSHAKE v11.0 (STA Sync)
        if !hwnd_win.0.is_null() {
            synchronize_handshake(hwnd_win);
        }

        file_op
            .PerformOperations()
            .map_err(|e| format!("PerformOperations failed: {}", e))?;
        notify_refresh();
    }
    Ok(())
}

fn delete_items_impl(paths: Vec<String>, hwnd: Option<isize>) -> Result<(), String> {
    unsafe {
        let file_op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create IFileOperation: {}", e))?;

        let _ =
            file_op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR);

        // --- LIFETIME EXTENSION (v8.1) ---
        let mut _input_guard: Option<ThreadInputGuard> = None;
        let mut hwnd_win = windows::Win32::Foundation::HWND::default();

        if let Some(h) = hwnd {
            hwnd_win = windows::Win32::Foundation::HWND(h as *mut _);
            log_sta_diagnostic("BEFORE PerformOperations (Delete)", hwnd_win);
            _input_guard = Some(ThreadInputGuard::new(hwnd_win));
            let _ = file_op.SetOwnerWindow(hwnd_win);
        }

        for f in &paths {
            if let Ok(item) = create_shell_item(f) {
                let _ = file_op.DeleteItem(&item, None);
            }
        }

        // HANDSHAKE v11.0 (STA Sync)
        if !hwnd_win.0.is_null() {
            synchronize_handshake(hwnd_win);
        }

        file_op
            .PerformOperations()
            .map_err(|e| format!("PerformOperations failed: {}", e))?;
        notify_refresh();
    }
    Ok(())
}

fn rename_item_impl(path: String, new_name: String, hwnd: Option<isize>) -> Result<(), String> {
    unsafe {
        let file_op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create IFileOperation: {}", e))?;

        let _ =
            file_op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR);

        // --- LIFETIME EXTENSION (v8.1) ---
        let mut _input_guard: Option<ThreadInputGuard> = None;
        let mut hwnd_win = windows::Win32::Foundation::HWND::default();

        if let Some(h) = hwnd {
            hwnd_win = windows::Win32::Foundation::HWND(h as *mut _);
            log_sta_diagnostic("BEFORE PerformOperations (Rename)", hwnd_win);
            _input_guard = Some(ThreadInputGuard::new(hwnd_win));
            let _ = file_op.SetOwnerWindow(hwnd_win);
        }

        let item: IShellItem = create_shell_item(&path)
            .map_err(|e| format!("Failed to create item: {}", e))?;

        let name_wide: Vec<u16> = OsStr::new(&new_name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let _ = file_op.RenameItem(&item, PCWSTR(name_wide.as_ptr()), None);

        // HANDSHAKE v11.0 (STA Sync)
        if !hwnd_win.0.is_null() {
            synchronize_handshake(hwnd_win);
        }

        file_op
            .PerformOperations()
            .map_err(|e| format!("PerformOperations failed: {}", e))?;
        notify_refresh();
    }
    Ok(())
}

fn paste_items_impl(
    paths: Vec<String>,
    target_path: String,
    is_move: bool,
    hwnd: Option<isize>,
) -> Result<Vec<String>, String> {
    log::debug!(
        "[STA-WORKER] paste_items_impl called with {} files to {} (is_move: {})",
        paths.len(),
        target_path,
        is_move
    );

    unsafe {
        let file_op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create IFileOperation: {}", e))?;

        let _ =
            file_op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR);

        // --- LIFETIME EXTENSION (v8.1) ---
        let mut _input_guard: Option<ThreadInputGuard> = None;
        let mut hwnd_win = windows::Win32::Foundation::HWND::default();

        if let Some(h) = hwnd {
            hwnd_win = windows::Win32::Foundation::HWND(h as *mut _);
            log_sta_diagnostic("BEFORE PerformOperations (Paste)", hwnd_win);
            _input_guard = Some(ThreadInputGuard::new(hwnd_win));
            let _ = file_op.SetOwnerWindow(hwnd_win);
        }

        let dest_item: IShellItem = create_shell_item(&target_path)
            .map_err(|e| format!("Failed to create destination item: {}", e))?;

        for f in &paths {
            if let Ok(item) = create_shell_item(f) {
                if is_move {
                    let _ = file_op.MoveItem(&item, &dest_item, PCWSTR(std::ptr::null()), None);
                } else {
                    let _ = file_op.CopyItem(&item, &dest_item, PCWSTR(std::ptr::null()), None);
                }
            }
        }

        // HANDSHAKE v11.0 (STA Sync)
        if !hwnd_win.0.is_null() {
            synchronize_handshake(hwnd_win);
        }

        file_op
            .PerformOperations()
            .map_err(|e| format!("PerformOperations failed: {}", e))?;
        notify_refresh();
    }

    Ok(paths)
}
