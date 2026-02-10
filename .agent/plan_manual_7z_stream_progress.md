# Manual Byte-Level Progress for 7Z Extraction

## Objective
Enable smooth, real-time progress updates for 7Z files by replacing `sevenz_rust::decompress_file_with_extract_fn` with a manual decompression loop. This allows us to track bytes written *during* the extraction of each file, solving the issue where the progress bar freezes or never appears for large files.

## Proposed Changes

### [MODIFY] [extraction.rs](file:///d:/SpeedExplorer/src-tauri/src/extraction.rs)

1.  **Iterate Entries Manually**:
    Instead of using the high-level helper, we will iterate over `reader.archive().files` manually.
2.  **Filter Folders**: Skip entries that are directories (`entry.has_stream` is false or `entry.is_directory` is true).
3.  **Manual Decompression Loop**:
    Use `reader.extract_item(folder_index, ...)` or a lower-level API if available to stream data.
    *Critically*: `sevenz-rust` 0.6 exposes `reader.for_each_entries(...)` or we must use `reader.item_reader(...)` to get a `Read` implementation for each entry.
    
    *Investigation Note*: `sevenz-rust`'s API is tricky. The most reliable way to get a reader for an entry is often missing in high-level docs. We will check if `Action::Extract` with a custom `output` writer that counts bytes is feasible, OR if we can get a `Read` object for the entry.
    
    *Plan B (Stream Copy)*: If `sevenz-rust` only pushes data to a writer, we will wrap our `File` writer in a `ProgressWriter` struct that updates the progress bar on every `write()` call. This is cleaner and works with any "push-style" extraction API.

### Detailed Implementation (Plan B - ProgressWriter)

We will create a wrapper around `std::fs::File`:

```rust
struct ProgressWriter<W: Write> {
    inner: W,
    window: tauri::Window,
    bytes_written: Arc<AtomicU64>,
    total_bytes: u64,
    // ... logic to call report_progress
}

impl<W: Write> Write for ProgressWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        // Update atomic counter
        // Check throttling
        // Emit event if needed
        Ok(n)
    }
    // ... impl flush
}
```

Then we pass this `ProgressWriter` to `sevenz_rust::default_entry_extract_fn` (if it accepts a writer) or manually copy if we can get a reader.

**Correction**: `sevenz-rust`'s `default_entry_extract_fn` handles the file creation internally. We cannot inject a writer easily there.
**Better Approach**: We must use `decompress_file_with_extract_fn` but providing a *custom* extract function that:
1. Opens the target file itself.
2. Creates our `ProgressWriter` wrapping that file.
3. Uses `sevenz_rust::pack::PackReader` or similar internals if exposed?
   
   *Wait*, `sevenz-rust` documentation shows `decompress_file_with_extract_fn` signature receives `entry`, `reader`, and `dest`. The `reader` is a `&mut dyn Read`. 
   
   **Eureka**: The closure receives a `reader`!
   ```rust
   move |entry, reader, _dest| {
       // Open file manually
       let mut out_file = File::create(path)?;
       // Copy manually with buffer !!
       std::io::copy(reader, &mut out_file) // <--- replace this with our buffered copy loop!
   }
   ```
   
   The `reader` argument in the closure is the *decompressed stream* for that entry. We just need to stop delegating to `default_entry_extract_fn` and do the copy ourselves with our existing loop logic.

## Steps
1.  **Refactor `extract_7z`**:
    - Remove `default_entry_extract_fn`.
    - Manually resolve the output path for the entry.
    - Create parent directories.
    - Create the file.
    - Use a buffered copy loop (like in ZIP) to read from the provided `reader` (which yields decompressed bytes) and write to the file, updating progress along the way.

## Complexity
- **3/10** — We reuse the buffered copy logic from ZIP. The key is knowing that the closure gives us a Reader.

## Verification
- Test with 7Z file. Progress should now be smooth and granular.
