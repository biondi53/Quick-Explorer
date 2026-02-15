//! Drop Overlay Module
//!
//! Creates a native Win32 overlay window that intercepts Drag & Drop events,
//! bypassing WebView2's OLE handling completely.

use crate::APP_HANDLE;
use std::sync::OnceLock;
use tauri::Emitter;
use windows::core::{implement, Ref, PCWSTR};
use windows::Win32::Foundation::{
    COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, POINTL, WPARAM,
};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::System::Com::{IDataObject, FORMATETC, STGMEDIUM, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, DROPEFFECT, DROPEFFECT_COPY,
    DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON};
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetWindow, KillTimer, RegisterClassW,
    SetLayeredWindowAttributes, SetTimer, SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW,
    GW_OWNER, LWA_ALPHA, SWP_NOACTIVATE, SW_HIDE, SW_SHOW, WM_NCHITTEST, WM_SETCURSOR, WM_TIMER,
    WNDCLASSW, WS_EX_LAYERED, WS_POPUP,
};

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

#[tauri::command]
pub fn show_overlay(rect: OverlayRect) {
    if let Some(h) = OVERLAY_HWND.get() {
        let hwnd = HWND(*h as *mut _);
        unsafe {
            let mut x = rect.x;
            let mut y = rect.y;

            // 1. Convert client-relative coordinates (from WebView) to screen-absolute coordinates (for WS_POPUP)
            if let Ok(parent_hwnd) = GetWindow(hwnd, GW_OWNER) {
                let mut pt = POINT {
                    x: rect.x,
                    y: rect.y,
                };
                if ClientToScreen(parent_hwnd, &mut pt).as_bool() {
                    x = pt.x;
                    y = pt.y;
                    // log::info!("[OVERLAY] Coords converted: Client({},{}) -> Screen({},{})", rect.x, rect.y, x, y);
                }
            }

            // 2. Position and show overlay exactly over the target area
            let _ = SetWindowPos(hwnd, None, x, y, rect.width, rect.height, SWP_NOACTIVATE);
            let _ = ShowWindow(hwnd, SW_SHOW);

            // 3. Start movement/escape exit timer (100ms)
            let _ = SetTimer(Some(hwnd), 1, 100, None);
        }
    }
}

#[tauri::command]
pub fn hide_overlay() {
    if let Some(h) = OVERLAY_HWND.get() {
        let hwnd = HWND(*h as *mut _);
        unsafe {
            let _ = KillTimer(Some(hwnd), 1);
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}

pub fn create_drop_overlay(parent_hwnd: HWND) {
    if OVERLAY_HWND.get().is_some() {
        return;
    }

    unsafe {
        let h_instance = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).unwrap();
        let class_name_w: Vec<u16> = format!("{}\0", OVERLAY_CLASS_NAME).encode_utf16().collect();
        let class_name_pcwstr = PCWSTR(class_name_w.as_ptr());

        let wnd_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc_w),
            hInstance: HINSTANCE(h_instance.0),
            hCursor: windows::Win32::UI::WindowsAndMessaging::LoadCursorW(
                None,
                windows::Win32::UI::WindowsAndMessaging::IDC_ARROW,
            )
            .unwrap(),
            hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
            lpszClassName: class_name_pcwstr,
            ..Default::default()
        };

        RegisterClassW(&wnd_class);

        let hwnd = CreateWindowExW(
            WS_EX_LAYERED,
            class_name_pcwstr,
            PCWSTR::null(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            Some(parent_hwnd),
            None,
            Some(HINSTANCE(h_instance.0)),
            None,
        )
        .unwrap();

        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 100, LWA_ALPHA); // ~40% opacity

        // --- OLE REGISTRATION ---
        let drop_target: IDropTarget = OverlayDropTarget { hwnd }.into();
        match RegisterDragDrop(hwnd, &drop_target) {
            Ok(_) => log::info!("[OLE] RegisterDragDrop SUCCESS for {:?}", hwnd),
            Err(e) => log::error!("[OLE] RegisterDragDrop FAILED: {:?}", e),
        }

        OVERLAY_HWND.set(hwnd.0 as isize).unwrap();
        log::info!("[OVERLAY] Created overlay window: {:?}", hwnd);
    }
}

unsafe extern "system" fn wnd_proc_w(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_NCHITTEST => LRESULT(1), // HTCLIENT
        WM_SETCURSOR => DefWindowProcW(hwnd, msg, wparam, lparam),
        WM_TIMER => {
            // Check for exit conditions: mouse released or Escape pressed
            unsafe {
                if GetAsyncKeyState(VK_LBUTTON.0 as i32) == 0
                    || GetAsyncKeyState(VK_ESCAPE.0 as i32) != 0
                {
                    let _ = KillTimer(Some(hwnd), 1);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                    log::info!("[OVERLAY] Timer Exit: Mouse released or Esc pressed");
                }
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// OLE Drop Target Implementation
#[implement(IDropTarget)]
struct OverlayDropTarget {
    hwnd: HWND,
}

impl IDropTarget_Impl for OverlayDropTarget_Impl {
    fn DragEnter(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> windows_core::Result<()> {
        log::info!("[OLE] DragEnter");
        unsafe {
            if let Ok(data_obj) = pdataobj.ok() {
                if has_file_format(data_obj) {
                    *pdweffect = DROPEFFECT_COPY;
                } else {
                    *pdweffect = DROPEFFECT_NONE;
                }
            } else {
                *pdweffect = DROPEFFECT_NONE;
            }
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> windows_core::Result<()> {
        unsafe {
            *pdweffect = DROPEFFECT_COPY;
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows_core::Result<()> {
        log::info!("[OLE] DragLeave");
        Ok(())
    }

    fn Drop(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> windows_core::Result<()> {
        log::info!("[OLE] Drop");
        unsafe {
            *pdweffect = DROPEFFECT_NONE;
            if let Ok(data_obj) = pdataobj.ok() {
                let paths = extract_paths(data_obj);
                if !paths.is_empty() {
                    *pdweffect = DROPEFFECT_COPY;
                    log::info!("[OLE] Multi-file drop detected: {} paths", paths.len());

                    // Emit event to frontend
                    if let Some(app) = APP_HANDLE.get() {
                        let _ = app.emit("app:file-drop", &paths);
                        log::info!("[OLE] Event emitted successfully");
                    }
                }
            }

            // Cleanup overlay
            let _ = KillTimer(Some(self.hwnd), 1);
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
        Ok(())
    }
}

unsafe fn has_file_format(data_obj: &IDataObject) -> bool {
    let format_etc = FORMATETC {
        cfFormat: 15, // CF_HDROP
        ptd: std::ptr::null_mut(),
        dwAspect: 1, // DVASPECT_CONTENT
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    data_obj.QueryGetData(&format_etc).is_ok()
}

unsafe fn extract_paths(data_obj: &IDataObject) -> Vec<String> {
    let mut paths = Vec::new();
    let format_etc = FORMATETC {
        cfFormat: 15, // CF_HDROP
        ptd: std::ptr::null_mut(),
        dwAspect: 1, // DVASPECT_CONTENT
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };

    if let Ok(medium) = data_obj.GetData(&format_etc) {
        if !medium.u.hGlobal.0.is_null() {
            let hdrop = HDROP(medium.u.hGlobal.0 as *mut _);
            let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, None);
                let mut buffer = vec![0u16; len as usize + 1];
                DragQueryFileW(hdrop, i, Some(&mut buffer));
                paths.push(String::from_utf16_lossy(&buffer[..len as usize]));
            }
            ReleaseStgMedium(&medium as *const STGMEDIUM as *mut STGMEDIUM);
        }
    }
    paths
}
