# Spec: High-Performance Recursive Search

## 1. Goal
Implement a manual, high-performance recursive file search limited to the current directory and its subfolders, providing real-time feedback via a progressive status bar.

## 2. Technical Architecture

### Backend (Rust/Tauri)
- **Command**: `recursive_search(path: String, query: String, nav_id: String)`
- **Engine**: Use `rayon` for parallel directory traversal.
- **Concurrency**: Process subdirectories in parallel to maximize I/O throughput.
- **IPC**: Emit `search-found` events for each match using `window.emit`.
- **Throttling**: Debounce/buffer emitted events (e.g., every 50ms or 100 items) to prevent frontend UI lockup.
- **Cancellation**: Monitor `GLOBAL_NAV_ID`. If the user navigates away, the search thread must terminate immediately.
- **Safety**: Silently skip directories with permission errors (e.g., system folders).

### Frontend (React/TypeScript)
- **Trigger**: A new "Deep Search" button (icon: `Search` with a plus or sparkle) next to the search input.
- **State**: `isDeepSearching` boolean in `useTabs.ts`.
- **UI Component**: `SearchProgressBar` positioned below the search input.
- **Interaction**:
    1. User enters text in search bar (current client-side filter triggers).
    2. User clicks "Deep Search".
    3. `recursive_search` is invoked.
    4. UI shows progress bar and "Searching..." status.
    5. Results are appended to the current tab's file list as they arrive.
- **Clean up**: Clearing the search input or navigating stays the same, but must also ensure `isDeepSearching` is reset and backend is cancelled.

## 3. Data Flow
1. `DeepSearchButton` click -> `triggerDeepSearch(query)` in `useTabs`.
2. `useTabs` -> `invoke("recursive_search", ...)` -> Rust backend.
3. Rust -> Parallel walk -> match found -> `emit("search-found", entry)`.
4. `useTabs` -> `listen("search-found")` -> update `files` state in the active tab.

## 4. Error Handling
- **No results**: Show "No matches found in subfolders" in the progress bar area.
- **Access Denied**: Skip protected folders without interrupting the search.
- **Multiple searches**: Ensure only one recursive search is active per tab; starting a new one cancels the previous.

## 5. Verification Plan
- **Unit Test (Rust)**: Test `recursive_search_impl` with a mock directory structure.
- **Manual Test**: Search in a large project folder (e.g., `node_modules`) to verify performance and cancellation.
- **UI Test**: Confirm the progress bar appears/disappears correctly and the "Deep Search" button state is consistent.
