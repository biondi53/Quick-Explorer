# <img src="img/README8.png" height="28" style="vertical-align: -5px;"> Quick Explorer

**Quick Explorer** is a high-performance, modern file manager for Windows built with **Tauri**, **Rust**, and **React**. Designed for speed and stability.

Developed with ❤️ using **Antigravity**.

---

## ✨ Core Features

### 📂 Advanced Tab System
- **Dynamic Multi-tabbing**: Open and manage multiple locations with ease.
- **Auto-Scroll Intelligence**: Smart tab visibility management for complex workflows.

### 🛡️ Rock-Solid Windows Integration
- **Enhanced Windows Integration**: Optimized for stability during heavy Windows Shell operations.
- **Native Inbound Drag & Drop**: Intercepts files directly from the OS using a custom Rust-based overlay, bypassing browser limitations.
- **High-Fidelity Feedback**: Supports native Windows drag images with real thumbnails and smart "+N" count badges for multi-file operations.
- **Instant Shell Previews**: High-speed thumbnail generation and metadata fetching for images and videos.

### 📦 Native Archive Support
- **Integrated Extraction**: Built-in, high-performance extraction for **ZIP** and **7Z** archives without external dependencies.
- **Taskbar Progress**: Visual real-time extraction progress directly on the native Windows Taskbar.
- **Smart Flattening**: Automatically detects single-root archives to prevent unnecessary folder nesting.

### 🌐 Intelligent Localization (i18n)
- **Seamless Languages**: Full support for English, Spanish, and **Automatic** detection based on system settings.
- **Deep Translation**: Every UI element, including file types (Folder, Shortcut) and drive labels, adapts instantly to your language.

### 🔍 QuickPreview Overlay
- **One-Key Discovery**: Press `Spacebar` to instantly preview media and documents without opening external apps.
- **Smart Navigation Filter**: Effortlessly scroll through your files while the viewer automatically skips folders.

### 🎨 Modern Adaptive UI
- **Smart Toolbar**: The interface intelligently compacts itself (hiding labels) when space is limited, ensuring a clean look on any window size.

### ⚡ Performance First
- **Async Architecture**: Non-blocking folder listing and asset loading.
- **Direct Shell API Access**: Leverages native Windows APIs for maximum speed and compatibility.
- **Zero-Flicker Previews**: Clean, windowless media probing for an uninterrupted experience.

---

## 🛠️ Technology Stack

- **Backend**: [Rust](https://www.rust-lang.org/) + [Tauri v2](https://v2.tauri.app/)
- **Frontend**: [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling**: Vanilla CSS with modern aesthetics.
- **IDE**: [Antigravity IDE](https://antigravity.google)

---

## 🚀 Getting Started

### Installation (Recommended)

The easiest way to install **Quick Explorer** on Windows is via [Winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

```bash
winget install biondi53.QuickExplorer
