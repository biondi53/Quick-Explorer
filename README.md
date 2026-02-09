# 🚀 Quick Explorer

**Quick Explorer** is a high-performance, modern file manager for Windows built with **Tauri**, **Rust**, and **React**. Designed for speed and stability.

Developed with ❤️ using the **Antigravity**.

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
- **IDE**: [Antigravity IDE](https://antigravity.dev)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (latest LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Included in Windows 10/11)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/biondi53/Quick-Explorer.git
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

4. Build for production:
   ```bash
   npm run tauri build
   ```

---

*Quick Explorer Project © 2026*
