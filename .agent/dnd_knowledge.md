# Drag & Drop Debugging: Technical Knowledge Base

This document serves as a permanent record of the troubleshooting and resolution process for the Drag & Drop (D&D) blockage in the Quick Explorer (Tauri v2) project.

## 1. Problem Definition
The application initially displayed a **"crossed circle"** (OOS) cursor when dragging files from Windows File Explorer into the window. No events (`dragover`, `drop`) were received by either the Rust backend or the React frontend.

## 2. Windows System Analysis
### Integrity Levels & UIPI
- **Verification**: The app was checked for User Interface Privilege Isolation (UIPI) blocks.
- **Finding**: The app runs at **Medium Integrity (RID: 0x2000)**. UIPI is NOT the cause, as File Explorer also runs at Medium Integrity.

### Window Hierarchy (Win32)
The Tauri/WebView2 window hierarchy follows this structure:
1. `Speed Explorer` (Main Window)
2. `WRY_WEBVIEW` (Tauri WebView layer)
3. `Chrome_WidgetWin_0` (Main Chromium container)
4. `Chrome_WidgetWin_1` (Chromium sibling)
5. `Chrome_RenderWidgetHostHWND` (Actual rendering surface)
6. `Intermediate D3D Window` (DirectX surface)

## 3. The "Crossed Circle" Resolution
The cursor blockage was resolved by identifying and correcting Win32 style conflicts:

### Key Findings:
- **`WS_EX_ACCEPTFILES`**: This legacy flag (intended for `WM_DROPFILES`) actually **interferes** with modern OLE-based D&D used by WebView2. Removing it from the main window and ensuring child windows don't have it was critical.
- **Window Enablement**: Verification was performed to ensure no window in the hierarchy was `WS_DISABLED`.
- **Topmost/Layered Styles**: High-transparency or layered styles (`WS_EX_LAYERED`, `WS_EX_TRANSPARENT`) can sometimes block hit-testing for OLE.

### Implementation:
We implemented a Rust-side setup in `lib.rs` that:
1. Iterates through all child windows.
2. Force-clears `WS_EX_ACCEPTFILES` and other problematic ex-styles.
3. Ensures the window procedure is not blocked.

## 4. Recovering Event Flow (Silent Events)
Even after the cursor was fixed, events remained silent. 

### Strategy & Test Results:
- **`dragDropEnabled: false` (WINNER)**: Internal Tauri native D&D handlers can sometimes suppress OLE events before they reach the WebView's HTML5 engine. Disabling this in `tauri.conf.json` restores native HTML5 `drop` event flow.
- **`dragDropEnabled: true` (FAIL)**: Re-enabling this during testing immediately brought back the "crossed circle" cursor and silenced all browser events. This confirms that Tauri's native OLE registration is the root cause of the conflict in this project.
- **Global Listeners**: Adding global `dragover` and `drop` listeners in `App.tsx` bypassing React's event pooling or component-level logic for definitive debugging.

## 5. Functional Reality & Regressions (Post-Cursor Fix)
**Critical Update**: While the "crossed circle" is gone, two major issues persist:
1.  **Inbound Drop Action Missing**: The `drop` event fires (green log), but the *copy/move action* does not happen. The event handler is likely missing the connection to the Rust backend.
2.  **Outbound Drag Broken**: The previous `dragDropEnabled: false` fix **broke dragging files out of the app**. This suggests `dragDropEnabled` controls both inbound OLE target status AND outbound drag source initiation.
    - **Conflict**: We need `false` for Inbound (to stop blocking), but `true` for Outbound (to start dragging).

## 6. Lessons Learned for Future Models
- **Cursor != Function**: A correct cursor only means the OS is willing to drop. It does not mean the app is logic-ready.
- **Config Trade-off**: `dragDropEnabled: false` is a nuclear option that kills outbound drags. We must find a middle ground or a hybrid approach (see Section 7).

## 7. The Cross-Process Barrier & The Native Bridge Pivot (Ongoing)
During the latest session, we attempted a "deep window subclassing" to capture `WM_DROPFILES`.

### Critical Discovery:
- **Process Isolation**: Logging `GetWindowThreadProcessId` against `GetCurrentProcessId` confirmed that while the main window belongs to our app, the **Chromium Input/WebView child windows run in separate processes** (`msedgewebview2.exe`).
- **Technical Barrier**: `SetWindowSubclass` and other message-hooking techniques **cannot cross process boundaries**. This made the legacy subclassing approach scientifically impossible for this architecture.

### The "Native Bridge" Solution:
We reverted high-risk Win32 hacks and restored the standard Tauri configuration, implementing a custom bridge:
1. **Config**: `dragDropEnabled: true` restored (fixes Outbound Drag natively).
2. **Backend**: Listens to native `tauri::WindowEvent::DragDrop`. This is the *only* channel capable of OLE communication across the process barrier.
3. **Bridge**: Rust forwards file paths to React via a custom `app:drop` event.

### Status for next session:
- **Architecture**: Bridge implemented (Rust -> JS).
- **Blocker**: The `app:drop` event is currently "silent" in the dev environment despite correct setup. Needs event loop tracing.
