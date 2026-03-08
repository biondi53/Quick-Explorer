# 🚀 Quick Explorer v0.1.26
*Changelog - March 8, 2026*

## ✨ Middle-Click Preview & Rename UX
- **🖱️ Middle-Click Preview**: You can now instantly open file previews by clicking with the middle mouse button, in addition to the standard spacebar shortcut.
- **📝 Precise Rename UX**: Fixed a bug where double-clicking text during a rename operation would accidentally open the file. Double-clicking now correctly selects words within the filename for faster editing.
- **🔍 Preview Logic**: Middle-click on folders now opens them in a new tab, matching the behavior of modern web browsers.

---

# 🚀 Quick Explorer v0.1.25
*Changelog - March 7, 2026*

## ✨ Grid Performance & High-Fidelity DnD
- **🖱️ Grid DnD Fix**: Resolved a critical `SecurityError` (Tainted Canvas) that prevented dragging files with thumbnails in Grid Mode. The app now performantly fetches thumbnails manually to ensure stable drag initiation.
- **⚡ Instant Thumbnail Loading**: Removed the 300ms observer delay in Grid Mode. Thumbnails now load with 0ms latency, providing a truly "instant" visual experience.
- **🔵 Thumbnail Source Indicators**: Integrated visual cues (blue/orange dots) to differentiate between native Windows thumbnails and FFmpeg-generated ones, available in both Grid View and Info Panel.
- **📜 Maximized Scroll Fluidity**: Increased grid `overscan` to 5 rows, ensuring that neighboring items are pre-rendered and thumbnails pre-loaded before they enter the viewport.
- **🛠️ Diagnostic Cleanup**: Removed all internal DND tracing logs for a cleaner production console.

---

# 🚀 Quick Explorer v0.1.24
*Changelog - March 6, 2026*

## ✨ Asynchronous Pipeline & CPU Optimization
- **⚡ Asynchronous Thumbnail Protocol**: Migrated the entire thumbnail backend to Tauri's asynchronous protocol handler. This eliminates all IPC blocking, ensuring the UI remains 100% fluid regardless of folder size or media complexity.
- **🛡️ Tokio Semaphore Throttling**: Implemented a strict concurrency limit (4 concurrent operations) using a Tokio Semaphore. This protects system resources by preventing "thread explosion" during rapid scrolling.
- **🧠 Native Async FFmpeg**: Refactored the backend to use native Rust `async`/`.await` for all media processing. This ensures granular task management and immediate responsiveness to system interrupts.
- **🔍 Smart Fast-Scroll Filtering**: Injected a 300ms "grace period" into the grid visibility observer. The app now intelligently ignores files you pass by at high speed, zeroing out unnecessary CPU usage during long travels.
- **🔄 Performance Stability**: Eliminated the "black screen" and "jerky scroll" issues previously experienced under heavy load, providing a premium, high-end navigation experience.

---

# 🚀 Quick Explorer v0.1.23

## ✨ Folder Size Intelligence & System Branding
- **⚡ Asynchronous Folder Sizes**: Implemented a high-performance background engine using `Rayon` parallelism to calculate folder sizes without affecting UI responsiveness.
- **🛡️ Persistent Folder Cache**: Calculated sizes are now saved in `localStorage` (TTL 2h), allowing them to appear **instantly** when revisiting folders.
- **🧠 Intelligent Invalidation**: Added targeted cache clearing for Move, Copy, Delete, and Rename operations, ensuring sizes stay fresh without unnecessary re-calculations.
- **🟦 System Drive Identity**: The system drive (C:) now features a premium, enlarged Windows 11 logo in both the Sidebar and "This PC" views.
- **⚙️ Toolbar Customization**: New setting in **Ajustes > General** to choose between Dynamic (auto-collapse) and Compact (icons only) toolbar modes.
- **💾 Native Drive Renaming**: Fixed a limitation in the Windows Shell API; you can now rename physical disk volumes directly from the "This PC" view.
- **🎨 Refined Clipboard UI**: Modernized the "Paste" indicator with a cleaner, theme-accented chip design.

---

# 🚀 Quick Explorer v0.1.22
*Changelog - March 4, 2026*

## ✨ Navigation Stability & Input Refinement
- **🛡️ Smart History Jump**: Enhanced Back/Forward navigation to automatically skip deleted folders. It now also skips redundant paths (duplicates in history), ensuring you always land on a different location.
- **✨ Flicker-Free Address Bar**: The address bar now waits for a successful folder load before updating its text, providing a cleaner and more professional UI during rapid navigation.
- **🖱️ Native Input Context Menus**: Implemented a bespoke context menu (Cut, Copy, Paste, Select All) for all input fields. 
- **⚡ Paste and Go**: Added a specialized "Paste and Go" option to the address bar for instant navigation from the clipboard.
- **🛡️ Silent Revert**: Invalid manual path entries now silently revert to the previous valid location instead of showing technical errors.
- **⌨️ Auto-Selection**: Clicking the address bar now automatically selects all text for immediate replacement.
- **🔄 Race Condition Guards**: Implemented synchronous ref updates and safety timeouts to eliminate "infinite loading" hangs during fast history jumps.

---

# 🚀 Quick Explorer v0.1.21
*Changelog - March 3, 2026*

## ✨ Adaptive UI & Complete Localization
- **Adaptive Compact Toolbar**: Implemented a smart toolbar that automatically hides labels in small windows, ensuring a clean and usable interface even on narrow screens.
- **Robust Language Switching**: Solidified the transition between English, Spanish, and "Automatic" modes. Fixed a critical bug where the adaptive logic would desync after switching to Automatic.
- **🌍 Full Localized Types**: All file types (Folder, File, Shortcut) and drive labels (Local Disk) are now fully translated in every panel, providing a seamless native experience in both languages.
- **Seamless QuickPreview**: The Spacebar viewer now automatically skips folders, allowing you to browse through actual files with zero interruptions.
- **🎨 Visual Polish**: Refined toolbar animations and cleaned up legacy browser borders for a more premium, high-end feel.

---

# 🚀 Quick Explorer v0.1.20
*Changelog - March 3, 2026*

## ✨ Icon Refresh & Production Stability
- **New Visual Identity**: Updated the application icon to the final high-fidelity version (`FINAL8.PNG`), providing a more polished and professional look.
- **🛡️ Thumbnail Session Safety**: Implemented a robust session-aware thumbnail queuing system. Thumbnails now load reliably even when switching tabs rapidly or during drag-and-drop operations in production builds.
- **⚡ Performance Polish**: Optimized icon generation and splash screen assets for faster startup and better visual consistency.

---

# 🚀 Quick Explorer v0.1.19
*Changelog - February 28, 2026*

## ✨ Scroll & Layout Stabilization
- **Index-Based Scroll Tracking**: Replaced pixel-based scroll positions with index-based tracking, enabling perfect scroll synchronization even when switching between Grid and List views with different item heights.
- **🛡️ Anti-Flicker Technology**: Implemented "Strategic Hiding" during layout transitions. The file list remains invisible for a few milliseconds until it has correctly calculated its column count and target scroll position, eliminating jarring layout shifts.
- **⚡ Sub-Pixel Precision**: Added a mathematical tolerance (+50% height center) to scroll detection, preventing the scroll position from "creeping" upward due to browser sub-pixel rounding errors.
- **Race Condition Guard**: Fixed a critical bug where the grid would jump exponentially downwards on mount by preventing scroll restoration until the container width is fully measured.
- **Smooth Tab Restoration**: Refined the tab-switching logic to ensure that restored scroll positions are rock-solid and never interrupted by automatic selection scroll.
- **🔍 Quick Preview**: Added support for instant file previews using the `Spacebar`. Pressing space on a selected file opens a high-fidelity preview overlay.

---

# 🚀 Quick Explorer v0.1.18
*Changelog - February 20, 2026*

## 🖱️ Native Windows Drag Images & JIT Thumbnails
- **Native Inbound Images**: Integrated directly with Windows `IDropTargetHelper`. Dragging files from the native Explorer into Speed Explorer now displays a full-fidelity drag image (thumbnails + hints) over our custom drop overlay.
- **⚡ JIT List Thumbnails**: Implemented "Just-In-Time" thumbnail fetching. When dragging images or videos from the **List View**, the app now performs an ultra-fast backend lookup to provide a rich preview card instead of a generic icon.
- **🛡️ Precise Visual Feedback**: Enhanced WebView event handling to strictly show the "not-allowed" cursor in areas not supported for drops, preventing visual confusion.

---

# 🚀 Quick Explorer v0.1.17

## 🖱️ Dynamic High-Fidelity Ghost Icons
- **Accurate Previews**: Dragging an item now shows a translucent "ghost" version of the actual thumbnail or Lucide icon, providing instant visual feedback.
- **Counter Badge**: Dragging multiple items displays a smart "+N" badge in the ghost preview, matching the native experience of modern file explorers.
- **Glassmorphism Aesthetic**: The ghost preview card features a dark, semi-transparent "glass" background with smooth rounded corners.

---

# 🚀 Quick Explorer v0.1.16
*Changelog - February 17, 2026*

## ✨ Smooth Tab Transitions
- **Tab Switching Animation**: Introduced a premium fade-and-scale transition when switching between tabs, making the navigation experience smoother and more visually appealing.

---

# 🚀 Quick Explorer v0.1.15
*Changelog - February 17, 2026*

## 🖱️ Drag & Drop Fixes
- **Outbound DnD Stability**: Resolved a critical "race condition" (E_FAIL error) when dragging image files. The fix prevents the browser's native drag from interfering with the application's OLE drag operation.
- **Diagnostic Cleanup**: Removed experimental troubleshooting code from the backend to ensure maximum performance and stability.

---

# 🚀 Quick Explorer v0.1.14
*Changelog - February 15, 2026*

## 🎨 Visual Identity & Polish
- **New App Icon**: Updated the application icon to a modern, cleaner design.
- **Splash Screen Redesign**: Replaced the placeholder "Rocket" icon with the new app logo (128x128) and removed the container box for a sleeker, floating look.

---

# 🚀 Quick Explorer v0.1.13
*Changelog - February 12, 2026*

## ✨ Glow UI Refresh & Selection Fixes
- **Glow UI Refresh**: Modernized Settings, Sidebar, and Tab Bar with new Glow effects and refined layouts for a more premium feel.
- **🖱️ Multi-Selection Fix**: Resolved a critical bug where CTRL+click multi-selection was broken.
- **🎨 Aesthetic Improvements**: Introduced the `GlowCard` component and polished overall visual consistency across the app.
- **🛠️ Refined Layouts**: Optimized spacing and alignment in the Sidebar and Settings panel.

---

# 🚀 Quick Explorer v0.1.12
*Changelog - February 10, 2026*

## 🛡️ WinGet Compatibility Fix
- **Log Relocation**: Moved application logs from the installation directory to `%LOCALAPPDATA%\Quick Explorer\logs\debug.log`. This resolves permission issues during WinGet validation and ensures the application runs correctly as a standard user.

---

# 🚀 Quick Explorer v0.1.11
*Changelog - February 10, 2026*

## ✨ Native Archive Extraction

### 📦 Performant Decompression
- **Native Support**: Built-in ZIP and 7Z extraction without external dependencies.
- **Smart Flatting**: Automatic detection and flattening of single-root archives to prevent deep nesting.
- **Context Integration**: New "Extract Here" option in the context menu for supported formats.

### 📊 Real-Time Progress Indicator
- **Byte-Based Tracking**: Precise progress calculation based on bytes written, ensuring smooth feedback even for single large files.
- **Taskbar Integration**: Real-time native Windows Taskbar progress bar.
- **Streaming 7Z Architecture**: Custom manual decompression loop for 7Z files to provide granular, intra-file progress updates.

---

# 🚀 Quick Explorer v0.1.10
*Changelog - February 10, 2026*

## 🛡️ Stability and Automation (Version Focus)

### 🖱️ Drag & Drop Precision (v7.3)
- **Synchronous Global Lock**: Eliminated React latency by using a window-level lock for immediate internal drag detection.
- **Movement Pulse**: Integrated a mouse movement heart-beat to keep the drag state alive indefinitely while active.
- **Protected Sticky Sessions**: High-performance architecture ensuring drag stability even during heavy UI updates.

### 📦 Distribution Improvements
- **WinGet Automation**: Added GitHub action for automatic publishing to the Windows Package Manager.
- **Optimized Packaging**: Refined MSI and portable builds for better distribution.

### 🛡️ Critical Fixes & UI Enhancements
- **Focus Refresh Fix**: Resolved a critical issue where switching windows caused folder loops or UI freezes. Implemented a robust "Generation ID" system and stale closure prevention.
- **Video Indicators**: Added a subtle "Play" icon to video thumbnails in grid view for easy identification.

---

# 🚀 Quick Explorer v0.1.9
*Changelog - February 8, 2026*

## 🛡️ Stability and Performance (Version Focus)

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
*Quick Explorer Project © 2026 - Versión 0.1.26*
