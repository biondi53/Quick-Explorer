# Fix: 7Z Extraction Progress Tracking

## Objective
Fix the bug where 7Z extraction completes successfully but the progress bar remains stuck at 0%. This is caused by `bytes_written` being a simple `u64` captured by value/ref in a closure that may be re-instantiated or copied, leading to loss of accumulated progress.

## Root Cause Analysis
The `sevenz_rust::decompress_file_with_extract_fn` takes a closure. If this closure captures `mut bytes_written: u64` and is called multiple times (once per file), the state update logic is fragile. The variable might be resetting or not persisting across calls depending on how the closure is stored and invoked internally by the library.

## Proposed Solution: Atomic Counting

We will use thread-safe atomic counters to ensure the byte count persists across all closure invocations, regardless of how the closure is managed.

### [MODIFY] [extraction.rs](file:///d:/SpeedExplorer/src-tauri/src/extraction.rs)

1.  **Introduce `Arc<AtomicU64>`**:
    Instead of `let mut bytes_written = 0;`, use:
    ```rust
    let bytes_written = Arc::new(AtomicU64::new(0));
    let last_pct = Arc::new(AtomicU32::new(0));
    ```

2.  **Clone for Closure**:
    ```rust
    let bytes_written_clone = bytes_written.clone();
    let last_pct_clone = last_pct.clone();
    ```

3.  **Update in Closure**:
    Inside the closure, use `fetch_add` to safely increment the counter and `load` to read it for progress calculation.
    ```rust
    bytes_written_clone.fetch_add(entry_size, Ordering::Relaxed);
    let current_bytes = bytes_written_clone.load(Ordering::Relaxed);
    // ... calculate percentage and report
    ```

## Complexity
- **3/10** — Targeted fix in `extract_7z` function.

## Verification
- Extract a multi-file 7Z archive.
- Verify the progress bar advances smoothly from 0% to 100%.
