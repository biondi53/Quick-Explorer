//! Drop Overlay Module
//!
//! Creates a native Win32 overlay window that intercepts Drag & Drop events,
//! bypassing WebView2's OLE handling completely.

use std::sync::OnceLock;
use tauri::{Emitter, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::Shell::{DragAcceptFiles, DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{
    ChangeWindowMessageFilterEx, CreateWindowExW, DefWindowProcW, GetClientRect, GetCursorPos,
    GetForegroundWindow, GetWindow, GetWindowRect, KillTimer, RegisterClassW, SetForegroundWindow,
    SetLayeredWindowAttributes, SetTimer, SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW,
    GW_OWNER, HCURSOR, HICON, HWND_NOTOPMOST, HWND_TOPMOST, LWA_ALPHA, MSGFLT_ALLOW,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOW, WM_DROPFILES, WM_LBUTTONDOWN,
    WM_NCHITTEST, WM_SETCURSOR, WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_TOPMOST, WS_POPUP,
};
use windows_core::PCWSTR;

use crate::APP_HANDLE;

/// Static storage for the overlay HWND (created once per app lifetime)
static OVERLAY_HWND: OnceLock<isize> = OnceLock::new();

#[derive(serde::Deserialize)]
pub struct OverlayRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Window class name for the overlay
const OVERLAY_CLASS_NAME: &str = "SpeedExplorerDropOverlay";

/// Helper to demote parent window from TOPMOST back to normal
unsafe fn demote_parent(overlay_hwnd: HWND) {
    if let Ok(p) = GetWindow(overlay_hwnd, GW_OWNER) {
        if !p.0.is_null() {
            // Restore window stack precisely
            let foreground = GetForegroundWindow();

            if !foreground.0.is_null() && foreground != p {
                // Place our app RIGHT BEHIND the current foreground window (the drag source)
                let _ = SetWindowPos(
                    p,
                    Some(foreground),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            } else {
                // Fallback to normal behavior
                let _ = SetWindowPos(
                    p,
                    Some(HWND_NOTOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

/// Helper to bring parent window to foreground and activate it (called on drop)
unsafe fn bring_parent_to_foreground(overlay_hwnd: HWND) {
    if let Ok(p) = GetWindow(overlay_hwnd, GW_OWNER) {
        if !p.0.is_null() {
            // 1. Remove Topmost status
            let _ = SetWindowPos(
                p,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            // 2. Activate window (bring to front and give focus)
            let _ = SetForegroundWindow(p);
        }
    }
}

/// Window procedure for the drop overlay
unsafe extern "system" fn overlay_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // Log relevant messages for debugging
    if msg != 0x000F && msg != 0x0085 && msg != 0x0014 && msg != 0x0020 && msg != WM_TIMER {
        if msg == WM_DROPFILES {
            println!("[OVERLAY] !!! WM_DROPFILES DETECTED !!!");
        }
    }

    match msg {
        WM_NCHITTEST => {
            // Force the window to be interactive
            LRESULT(1) // HTCLIENT
        }
        WM_SETCURSOR => {
            // println!("[OVERLAY] WM_SETCURSOR");
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_DROPFILES => {
            let hdrop = HDROP(wparam.0 as *mut _);
            let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
            let mut paths = Vec::with_capacity(count as usize);

            for i in 0..count {
                let mut buffer = vec![0u16; 1024];
                let len = DragQueryFileW(hdrop, i, Some(&mut buffer));
                if len > 0 {
                    let path = String::from_utf16_lossy(&buffer[..len as usize]);
                    paths.push(path);
                }
            }

            DragFinish(hdrop);

            println!(
                "!!! [OVERLAY] WM_DROPFILES captured {} paths (TS: {}): {:?}",
                paths.len(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
                paths
            );

            // Emit event to frontend
            if let Some(app) = APP_HANDLE.get() {
                if let Some(win) = app.get_webview_window("main") {
                    println!(
                        "[OVERLAY] Emitting app:file-drop with {} paths",
                        paths.len()
                    );
                    match win.emit("app:file-drop", paths) {
                        Ok(_) => println!("[OVERLAY] Event emitted successfully"),
                        Err(e) => eprintln!("[OVERLAY] FAILED to emit event: {:?}", e),
                    }
                } else {
                    eprintln!("[OVERLAY] CRITICAL: Could not find 'main' window for emission");
                }
            } else {
                eprintln!("[OVERLAY] CRITICAL: APP_HANDLE is empty during drop");
            }

            // Hide overlay and kill timer after successful drop
            let _ = KillTimer(Some(hwnd), 1);
            let _ = ShowWindow(hwnd, SW_HIDE);
            bring_parent_to_foreground(hwnd); // Activate app on successful drop

            LRESULT(0)
        }
        WM_TIMER => {
            // Confirm the timer is still ticking
            static mut TICKS: u32 = 0;
            unsafe {
                TICKS += 1;
                if TICKS % 40 == 0 {
                    println!("[OVERLAY] Heartbeat (Timer still ticking...)");
                }
            }

            // Self-management logic: Hide if mouse leaves the APP or drag is cancelled
            let mut pt = POINT::default();
            if GetCursorPos(&mut pt).is_ok() {
                let mut is_inside_app = false;

                // Check against Parent Window (Main App) instead of the overlay itself
                // This prevents flickering when cursor is over Sidebar/Header
                if let Ok(parent) = GetWindow(hwnd, GW_OWNER) {
                    let mut rect = RECT::default();
                    if GetWindowRect(parent, &mut rect).is_ok() {
                        is_inside_app = pt.x >= rect.left
                            && pt.x <= rect.right
                            && pt.y >= rect.top
                            && pt.y <= rect.bottom;
                    }
                }

                // Check for cancel keys/buttons
                let is_esc_down = GetAsyncKeyState(VK_ESCAPE.0 as i32) != 0;
                let is_any_button_down = (GetAsyncKeyState(VK_LBUTTON.0 as i32) != 0)
                    || (GetAsyncKeyState(VK_RBUTTON.0 as i32) != 0);

                if !is_inside_app || !is_any_button_down || is_esc_down {
                    let _ = KillTimer(Some(hwnd), 1);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                    demote_parent(hwnd);
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            let _ = KillTimer(Some(hwnd), 1);
            let _ = ShowWindow(hwnd, SW_HIDE);
            demote_parent(hwnd);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Registers the overlay window class (called once)
fn register_overlay_class() -> bool {
    unsafe {
        let class_name_wide: Vec<u16> = OVERLAY_CLASS_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(overlay_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                .unwrap_or_default()
                .into(),
            hIcon: HICON::default(),
            hCursor: HCURSOR::default(),
            hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: PCWSTR(class_name_wide.as_ptr()),
        };

        let atom = RegisterClassW(&wc);
        if atom == 0 {
            let err = windows::Win32::Foundation::GetLastError();
            // 1410 = ERROR_CLASS_ALREADY_EXISTS is OK
            if err.0 != 1410 {
                eprintln!("[OVERLAY] RegisterClassW failed: {:?}", err);
                return false;
            }
        }
        true
    }
}

/// Creates the drop overlay window as a child of the parent HWND.
/// The overlay starts hidden and covers the entire client area.
pub fn create_drop_overlay(parent_hwnd: HWND) -> Option<HWND> {
    if let Some(&hwnd_val) = OVERLAY_HWND.get() {
        return Some(HWND(hwnd_val as *mut _));
    }

    if !register_overlay_class() {
        return None;
    }

    unsafe {
        let class_name_wide: Vec<u16> = OVERLAY_CLASS_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        // Get parent client rect to size the overlay
        let mut rect = windows::Win32::Foundation::RECT::default();
        let _ = GetClientRect(parent_hwnd, &mut rect);

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        // Create the overlay window
        // Using WS_POPUP to ensure it can be topmost, combined with WS_CHILD behavior via parenting
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_LAYERED, // Removed redundant WS_EX_ACCEPTFILES
            PCWSTR(class_name_wide.as_ptr()),
            PCWSTR::null(),
            WS_POPUP, // Absolute popup, owner is parent
            0,
            0,
            width,
            height,
            Some(parent_hwnd),
            None,
            None,
            None,
        );

        if hwnd.is_err() {
            eprintln!("[OVERLAY] CreateWindowExW failed");
            return None;
        }

        let hwnd = hwnd.unwrap();

        // Set semi-transparency
        let _ = SetLayeredWindowAttributes(
            hwnd,
            windows::Win32::Foundation::COLORREF(0x000000FF),
            128,
            LWA_ALPHA,
        );

        // Enable drag-drop acceptance
        DragAcceptFiles(hwnd, true);

        // UIPI Bypass: Explicitly allow drop messages
        let r1 = ChangeWindowMessageFilterEx(hwnd, WM_DROPFILES, MSGFLT_ALLOW, None);
        let r2 = ChangeWindowMessageFilterEx(hwnd, 0x0049, MSGFLT_ALLOW, None); // WM_COPYGLOBALDATA
        let r3 = ChangeWindowMessageFilterEx(hwnd, 0x004A, MSGFLT_ALLOW, None); // WM_COPYDATA

        // Store the HWND for later access
        let _ = OVERLAY_HWND.set(hwnd.0 as isize);

        println!(
            "[OVERLAY] Created overlay window: {:?}. FilterRes: {:?}, {:?}, {:?}",
            hwnd, r1, r2, r3
        );

        Some(hwnd)
    }
}

/// Shows the overlay window, resizing it to cover the parent's client area.
/// CRITICAL: All Win32 operations are dispatched to the Main Thread to ensure
/// SetTimer and window manipulation work correctly.
#[tauri::command]
pub fn show_overlay(window: tauri::Window, rect: Option<OverlayRect>) {
    let Some(&hwnd_val) = OVERLAY_HWND.get() else {
        println!("[OVERLAY] No overlay HWND found!");
        return;
    };

    // Capture parent HWND before moving to main thread
    let parent_hwnd_raw = window.hwnd().map(|h| h.0 as isize).ok();

    // Dispatch all Win32 operations to the Main Thread
    let app_handle = window.app_handle().clone();
    let _ = app_handle.run_on_main_thread(move || {
        let overlay_hwnd = HWND(hwnd_val as *mut _);

        unsafe {
            // Ensure timer is running (refreshed on every heartbeat)
            let timer_id = SetTimer(Some(overlay_hwnd), 1, 50, None);
            if timer_id == 0 {
                eprintln!("[OVERLAY] SetTimer FAILED in show_overlay");
            }

            // Get current parent size AND position
            if let Some(parent_raw) = parent_hwnd_raw {
                let parent = HWND(parent_raw as *mut _);

                // 1. Promote parent window to front (TOPMOST) first
                let _ = SetWindowPos(
                    parent,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );

                let (x, y, width, height) = if let Some(r) = rect {
                    // Convert parent client (0,0) to screen coordinates
                    let mut pt = POINT { x: 0, y: 0 };
                    let _ = ClientToScreen(parent, &mut pt);
                    (pt.x + r.x, pt.y + r.y, r.width, r.height)
                } else {
                    let mut rect_client = RECT::default();
                    if GetClientRect(parent, &mut rect_client).is_ok() {
                        let mut pt = POINT { x: 0, y: 0 };
                        let _ = ClientToScreen(parent, &mut pt);
                        (
                            pt.x,
                            pt.y,
                            rect_client.right - rect_client.left,
                            rect_client.bottom - rect_client.top,
                        )
                    } else {
                        (0, 0, 0, 0)
                    }
                };

                if width > 0 && height > 0 {
                    // 2. Position and promote overlay specifically to TOPMOST
                    let _ = SetWindowPos(
                        overlay_hwnd,
                        Some(HWND_TOPMOST),
                        x,
                        y,
                        width,
                        height,
                        SWP_NOACTIVATE,
                    );
                }

                // Start timer for self-management (check every 50ms)
                let _ = SetTimer(Some(overlay_hwnd), 1, 50, None);
            }

            let _ = ShowWindow(overlay_hwnd, SW_SHOW);
        }
    });
}

/// Hides the overlay window
#[tauri::command]
pub fn hide_overlay() {
    if let Some(&hwnd_val) = OVERLAY_HWND.get() {
        let overlay_hwnd = HWND(hwnd_val as *mut _);
        unsafe {
            let _ = KillTimer(Some(overlay_hwnd), 1);
            let _ = ShowWindow(overlay_hwnd, SW_HIDE);
            demote_parent(overlay_hwnd);
            println!("[OVERLAY] Hiding overlay and demoting parent");
        }
    }
}
