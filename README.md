# <img src="img/FINAL8.png" height="28" style="vertical-align: -5px;"> Quick Explorer

**Quick Explorer** is a high-performance, modern file manager for Windows built with **Tauri**, **Rust**, and **React**. Designed for speed and stability.

Developed with ❤️ using **Antigravity**.

---

## ✨ Core Features

### 📂 Advanced Tab System
- **Dynamic Multi-tabbing**: Open and manage multiple locations with ease.
- **Drag & Drop Reordering**: Organize your workspace with fluid, animated tab reordering.
- **Auto-Scroll Intelligence**: Smart tab visibility management for complex workflows.

### 🛡️ Rock-Solid Windows Integration
- **Enhanced Windows Integration**: Optimized for stability during heavy Windows Shell operations.
- **Native Inbound Drag & Drop**: Intercepts files directly from the OS using a custom Rust-based overlay, bypassing browser limitations.
- **Instant Shell Previews**: High-speed thumbnail generation and metadata fetching for images and videos.

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
