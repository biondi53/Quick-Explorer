# 🚀 Quick Explorer v0.1.9
*Changelog - February 8, 2026*

## 🛡️ Stability and Performance (Version Focus)

### 🧩 Total COM Isolation (Crash Fixes)
- **STA Worker Pool**: Implementation of a dedicated "Single-Threaded Apartment" (STA) thread pool for Windows Shell operations.
- **Access Violation Fix**: Definitively resolved the `STATUS_ACCESS_VIOLATION` error during file dragging by fully isolating COM environments.
- **Async Navigation**: File listing and recycle bin operations now run in isolated threads, preventing UI hangs.

### 📥 Inbound Drag & Drop
- **Native Drop Overlay**: Implemented a native Rust-based interception layer to capture files before they reach the web engine.
- **Cursor Fix**: Resolved the "prohibited" cursor issue when dragging external files into the application.
- **Instant Path Capture**: Robust absolute path recovery using the `WM_DROPFILES` message for immediate feedback upon dropping files.

### ⚡ Thumbnail & Preview Optimization
- **On-Demand Metadata**: File dimensions are now fetched only when needed, drastically speeding up large folder rendering.
- **Flicker-Free Processing**: FFmpeg video probing now runs invisibly, eliminating flashing terminal windows.
- **Instant Previews**: Preview images appear immediately from cache without waiting for metadata processing.

---

# 🚀 Quick Explorer v0.1.8
*Changelog - February 7, 2026*

## ✨ New Features

### 📝 Renaming Improvements
- **Smart Selection**: When renaming, the file name is automatically selected without the extension.
- **Auto Focus**: The text field receives focus instantly in both views.

## 🐛 Bug Fixes

- **Drag Synchronization**: Improved drag initiation timing to avoid conflicts.
- **Overlap Fix**: Resolved an issue where tabs would overlap when resizing.
- **Sticky Names**: The rename field now closes correctly when navigating.

---

# 🚀 Quick Explorer v0.1.7
*Changelog - January 30, 2026*

## ✨ New Features

### 🔄 Tab Reordering (Drag & Drop)
- **Drag and Drop**: You can now reorganize your tabs by dragging them horizontally.
- **Smooth Animations**: Tabs shift smoothly to make space while dragging.
- **Visual Feedback**: The dragged tab is elevated with a premium shadow.

### 📜 Smart Tab Auto-Scroll
- **Guaranteed Visibility**: When navigating with `Ctrl+Tab` or opening new tabs, the bar automatically scrolls to show the active tab.
- **Background Respect**: If "open tabs in background" is enabled, the bar will NOT scroll.
- **Invisible Bar**: Scrolling works without showing visible scrollbars.

### ⌨️ Selection with Shift+Home/End
- **`Shift + Home`**: Selects all files from the current one to the first in the list.
- **`Shift + End`**: Selects all files from the current one to the last in the list.

## ⌨️ Keyboard Shortcut Improvements

- `Ctrl+T` → New tab
- `Ctrl+W` → Close tab
- `Ctrl+Tab` / `Ctrl+Shift+Tab` → Navigate between tabs
- `F5` → Refresh directory
- `Ctrl+L` → Focus address bar
- `Escape` → Clear search and selection

---
*Quick Explorer Project © 2026 - Version 0.1.9*
