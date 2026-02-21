# 🚀 Quick Explorer v0.1.18
*Changelog - February 20, 2026*

## 🖱️ Native Windows Drag Images & JIT Thumbnails
- **Native Inbound Images**: Integrated directly with Windows `IDropTargetHelper`. Dragging files from the native Explorer into Speed Explorer now displays a full-fidelity drag image (thumbnails + hints) over our custom drop overlay.
- **⚡ JIT List Thumbnails**: Implemented "Just-In-Time" thumbnail fetching. When dragging images or videos from the **List View**, the app now performs an ultra-fast backend lookup to provide a rich preview card instead of a generic icon.
- **🛡️ Precise Visual Feedback**: Enhanced WebView event handling to strictly show the "not-allowed" cursor in areas not supported for drops, preventing visual confusion.


