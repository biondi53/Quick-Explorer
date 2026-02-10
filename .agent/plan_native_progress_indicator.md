# Plan: Native Extraction Progress Indicator

## Objective
Enhance the user experience of long-running archive extractions by providing visual feedback through the Windows Taskbar (native).

## 1. Native Taskbar Integration (Rust)

### Dependencies
- Check if `tauri::window::Window::set_progress_bar` or equivalent is available in Tauri v2, or use the `windows-rs` crate to access `ITaskbarList3`.

### Backend Changes (`extraction.rs`)
- **Event Emission**: Modify `extract_archive` to emit `extraction-progress` events.
    - Payload: `{ currentFile: string, totalFiles: number, processedFiles: number, percentage: number }`
- **Tauri Window Helper**:
    - `window.set_progress_bar(progress: u64)`: Updates the green progress bar on the taskbar icon.
    - `window.set_progress_state(state)`: Clean up (remove progress) when done or on error (turn red).

## 2. Implementation Steps

1.  **Backend**: Refactor `extract_zip` / `extract_7z` to accept a callback or channel for progress reporting.
2.  **Backend**: Implement the event loop to throttle updates (send every 1% or 100ms, not every file) to avoid IPC flooding.
3.  **Frontend**: Hook up the `listen()` in `App.tsx` and call `window.setProgressBar`.

## 3. Complexity Analysis
- **Complexity**: 4/10
- **Risk**: Low. Main challenge is ensuring the "Taskbar" API works seamlessly in Tauri v2.
