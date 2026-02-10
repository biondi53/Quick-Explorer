# Plan: Native Archive Extraction (ZIP & 7Z)

## Objective
Implement native extraction capabilities for `.zip` and `.7z` archives directly within SpeedExplorer. This feature will allow users to right-click an archive and select "Extract Here", handling the operation internally via Rust libraries without relying on external tools or the OS shell.

## 1. Backend Implementation (Rust)

### Dependencies
Add the following crates to `src-tauri/Cargo.toml`:
- `zip` (for .zip files) - Pure Rust, highly stable.
- `sevenz-rust` (for .7z files) - Pure Rust implementation of 7-zip.

### New Command: `extract_archive`
Create a new command in a dedicated module `src-tauri/src/extraction.rs`.

```rust
#[tauri::command]
fn extract_archive(archive_path: String, target_dir: String) -> Result<String, String> {
    // 1. Detect file type based on extension (or magic bytes if needed)
    // 2. Route to specific extractor function (extract_zip or extract_7z)
    // 3. Handle specific errors (Encrypted archives, Corrupt files)
    // 4. Return success message or error
}
```

### Extraction Logic
- **Smart Folder Creation**: 
    - If the archive contains multiple files at the root, create a folder with the archive's name and extract there.
    - If the archive contains a single folder at the root, extract it directly to avoid `Folder/Folder/Content` nesting.
- **Async Execution**: Use `tokio::task::spawn_blocking` to prevent freezing the main thread during large extractions.

## 2. Frontend Implementation (React)

### Context Menu Update (`ContextMenu.tsx`)
- **Detection**: Check if `selectedFile.name` ends with `.zip` or `.7z`.
- **UI**: Add a new menu item "Extract Here" (below "Copy/Paste").
- **Action**: Call `extract_archive` with the current path.

### User Feedback
- **Toast/Notification**: Show "Extracting [filename]..." immediately upon click.
- **Completion**: Show "Extraction Complete" or "Error: [Reason]" upon finish.
- **Refresh**: Automatically refresh the current directory view (`refreshCurrentTab`) after successful extraction.

## 3. Phased Rollout

### Phase 1: ZIP Support
- Implement basic ZIP extraction.
- Standard "Extract Here" logic.

### Phase 2: 7Z Support
- Add `sevenz-rust` support.
- Handle multi-part/solid archives if possible (likely limited in v1).

### Phase 3: Advanced Features (Future)
- "Extract to..." dialog.
- Password prompt for encrypted archives.
- RAR support (requires `unrar` C++ bindings, high complexity).

## 4. Complexity Analysis
- **Complexity**: 5/10
- **Risk**: Low. Pure Rust libraries are memory-safe. Main risk is handling edge cases (corrupt files, huge files) gracefully without crashing the app.
