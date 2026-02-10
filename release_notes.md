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
