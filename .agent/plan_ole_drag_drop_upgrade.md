# Plan: Upgrade Native Drop Overlay to OLE (IDropTarget)

## Objective
Transition the current `SpeedExplorerDropOverlay` from the legacy `WM_DROPFILES` messaging system to a modern OLE-based `IDropTarget` implementation. This is the definitive fix for issues with compressed archives and UI freezes.

## Reasoning
- **Fix Error 124 (Access Denied)**: Prevents compressed archive managers (NanaZip, 7-Zip, WinRAR) from deleting temporary files before the application can copy them. By using OLE, we can tell the source "I'm not done yet," keeping the files alive.
- **Eliminate UI Freezes**: Resolves the freeze when dragging from Windows Explorer. The modern protocol allows Windows to extract files without blocking the recipient's main thread during the "DragEnter" phase.
- **Maintain Current Successes**: Keeps the "Native Overlay" window architecture that successfully bypassed Chromium's process isolation and recovered the "Copy/Move" cursor.

## Proposed Technical Changes

### 1. Implement IDropTarget Trait (Rust)
Create a structure in `drop_overlay.rs` that implements the COM `IDropTarget` interface using `windows-rs`.
- `DragEnter`: Inspect the `IDataObject` for the `CF_HDROP` format.
- `DragOver`: Provide real-time feedback to the OS about the drop effect (`COPY` or `MOVE`).
- `DragLeave`: Cleanup the overlay state if the user cancels.
- `Drop`: Retrieve the `STGMEDIUM`, extract the file paths, and signal `S_OK` to the source application only AFTER the copy operation is safely underway.

### 2. OLE Registration
- Replace the legacy `DragAcceptFiles(hwnd, true)` call with `RegisterDragDrop(hwnd, pDropTarget)`.
- Ensure the overlay thread is initialized with `CoInitializeEx` and the appropriate apartment model (`STA`).

### 3. Data Extraction Bridge
- Transform the `IDataObject` into the familiar `Vec<String>` format already used by the frontend.
- Continue using the `app:file-drop` event bus, ensuring 0 changes are needed in the React `App.tsx` logic.

## Verification Plan
1. **Archive Test**: Drag a file from a `.zip` in NanaZip and verify it copies without failure.
2. **Responsiveness Test**: Drag a 1GB file from a Windows Explorer zip folder and verify the app remains responsive.
3. **Regression Test**: Ensure internal drags (between tabs) still correctly use the "Strict Guard" and do not trigger the overlay.

## Complexity & Risk (7/10)
- **High**: COM boilerplate and reference counting (`AddRef`/`Release`) are sensitive in Rust.
- **Medium**: Threading models (`STA`) must be strictly followed to avoid deadlocks with the Tauri main loop.
