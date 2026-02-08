# Implementation Plan: Plugin Hybrid Drag and Drop

**Date**: 2026-02-08  
**Status**: Pending Approval

## Problem Summary

The `dragDropEnabled: true` setting in Tauri causes the OS to show a "prohibited" cursor because Tauri's internal OLE handler consumes the events before they reach the WebView. No strategies to "unblock" this while keeping the setting enabled have worked (see `dnd_knowledge.md` Section 8).

## Proposed Solution: Plugin Hybrid

This strategy separates **inbound** and **outbound** drag functionality:

### Inbound Drop (Files from OS -> App)
1. Set `dragDropEnabled: false` in `tauri.conf.json`.
2. This removes Tauri's OLE blocker, allowing standard HTML5 `dragover`/`drop` events to fire in the WebView.
3. Handle the drop in `App.tsx` using standard DOM event listeners.
4. **Limitation**: `event.dataTransfer.files` in a WebView only provides sanitized `File` objects, NOT absolute paths. We need to investigate a workaround.

### Outbound Drag (Files from App -> OS)
1. The project already uses `@crabnebula/tauri-plugin-drag` for outbound drags.
2. This plugin uses its own native initiation via `startDrag({ item: paths, icon })` and is **independent** of the `dragDropEnabled` config.
3. **Verification needed**: Confirm that `tauri-plugin-drag` works when `dragDropEnabled: false`.

---

## Proposed File Changes

### [MODIFY] tauri.conf.json
- Change `dragDropEnabled` from `true` to `false`.

### [MODIFY] App.tsx
- Update the global drop handler to use standard HTML5 `drop` event instead of Tauri's `listen`.
- **Key Issue**: HTML5 `event.dataTransfer.files` does not provide absolute paths. A workaround will be needed (Phase 2).

### [CLEANUP] lib.rs
- Remove the `on_window_event` DragDrop handler since we're no longer using Tauri's native OLE system for inbound drops.
- Remove the recursive `WS_EX_ACCEPTFILES` cleaner as it's no longer needed.

---

## Verification Plan

### Step 1: Cursor Test
- After changing `dragDropEnabled` to `false`, drag a file from Explorer.
- **Expected**: The cursor should change from "prohibited" to "copy".

### Step 2: Outbound Drag Test
- Select a file in Quick Explorer and try to drag it to the Desktop.
- **Expected**: This must still work via `tauri-plugin-drag`.

### Step 3: Inbound Drop Test (Limited)
- Drop a file onto the app.
- **Expected**: Console should log the dropped files (even if paths are not absolute yet).

---

## Known Risks

> [!WARNING]
> **Path Resolution Blocker**: HTML5 drop events do not provide absolute paths for security reasons. This plan may require a second phase to resolve this issue. Options include:
> 1. Reading the system clipboard in Rust immediately after the drop event.
> 2. Using a temporary "drop zone" that logs file names and sizes for identification.
> 3. Researching if WebView2 has a specific API for this.
