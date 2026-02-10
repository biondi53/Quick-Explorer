# Byte-Based Extraction Progress

## Objective
Refactor extraction progress from counting files to tracking **bytes written vs. total uncompressed bytes**. This ensures smooth, accurate progress even for archives containing a single large file.

## Proposed Changes

### [MODIFY] [extraction.rs](file:///d:/SpeedExplorer/src-tauri/src/extraction.rs)

#### ZIP: Byte-level progress via buffered copy
1. **Pre-scan total bytes**: Replace `archive.len()` count with a loop summing `entry.size()` (uncompressed size) for all entries.
2. **Replace `std::io::copy`**: Use a manual `loop { read → write → accumulate }` with a fixed buffer (64KB). After each chunk written, update `bytes_written` and recalculate percentage.
3. **Throttle updates**: Only call `set_progress_bar` + `emit` when the percentage has changed by ≥1% since the last update, preventing IPC flooding.

#### 7Z: Cumulative file-size progress
1. **Pre-scan total bytes**: Sum `entry.size()` from the SevenZReader archive metadata instead of counting files.
2. **In the callback**: After each entry completes, add its `entry.size()` to `bytes_written` and update progress.

#### Shared: Throttling & graceful finish
- Track `last_reported_pct: u32` and only update when `new_pct > last_reported_pct`.
- After extraction completes, emit 100% and `thread::sleep(200ms)` before resetting to `ProgressBarStatus::None`.

## Complexity
- **4/10** — Only modifying `extraction.rs`. No new dependencies or frontend changes needed.

## Verification
- Test with a ZIP containing one large file (>100MB) → bar should fill gradually.
- Test with a ZIP containing many small files → bar should advance smoothly without flickering.
- Test with a 7Z archive → bar should advance per-entry and reach 100%.
- Test with a very small archive (<1MB) → bar should flash briefly and disappear cleanly.
