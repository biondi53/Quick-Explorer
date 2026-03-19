# High-Performance Recursive Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a manual, high-performance recursive file search limited to the current directory and its subfolders, providing real-time feedback via a progressive status bar.

**Architecture:** Use `rayon` for parallel directory traversal in Rust, emitting streaming results via Tauri events. The frontend UI will feature a "Deep Search" button and a dedicated progress bar for feedback.

**Tech Stack:** Rust (Rayon, Tauri), React (TypeScript).

---

### Task 1: Backend Infrastructure - Search Command and Events

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/sta_worker.rs`

- [ ] **Step 1: Define `SearchMatch` and register the `recursive_search` command**

```rust
// In lib.rs
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SearchMatch {
    pub file: FileEntry,
}

#[tauri::command]
pub async fn recursive_search(
    path: String,
    query: String,
    nav_id: String,
    window: tauri::Window,
) -> Result<(), String> {
    StaWorker::global().recursive_search(path, query, nav_id, window).await
}

// Register in generate_handler!
```

- [ ] **Step 2: Implement the bridge in `StaWorker`**

```rust
// In sta_worker.rs
pub async fn recursive_search(
    &self,
    path: String,
    query: String,
    nav_id: String,
    window: tauri::Window,
) -> Result<(), String> {
    // Logic will be implemented in Task 2
    Ok(())
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/sta_worker.rs
git commit -m "feat: setup recursive_search infrastructure"
```

---

### Task 2: Backend Core - Parallel Search Engine

**Files:**
- Modify: `src-tauri/src/sta_worker.rs`

- [ ] **Step 1: Write a unit test for recursive search in a temporary directory**
Test that `recursive_search_impl` finds specific files in a nested structure.

- [ ] **Step 2: Implement the parallel traversal using `rayon` and `std::fs`**
Follow the spec's requirement for parallel processing and cancellation via `nav_id`.

```rust
// In sta_worker.rs
// Implementation of the search engine with cancellation and buffering
```

- [ ] **Step 3: Implement IPC event throttling**
Buffer matches and emit `search-found` every 50ms or 100 items. Emit `search-finished` when complete.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sta_worker.rs
git commit -m "feat: implement parallel search engine with throttling and cancellation"
```

---

### Task 3: Frontend - UI Components (TDD)

**Files:**
- Create: `src/components/DeepSearchButton.tsx`
- Create: `src/components/SearchProgressBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement `DeepSearchButton` with visual feedback**
Add icon and hover states.

- [ ] **Step 2: Implement `SearchProgressBar` with result count**
Ensure it respects the `isDeepSearching` state.

- [ ] **Step 3: Integrate into the main toolbar**

- [ ] **Step 4: Commit**

```bash
git add src/components/DeepSearchButton.tsx src/components/SearchProgressBar.tsx src/App.tsx
git commit -m "feat: implement deep search UI components"
```

---

### Task 4: Frontend - Logic Integration

**Files:**
- Modify: `src/hooks/useTabs.ts`

- [ ] **Step 1: Update tab state to track deep search**
Add `isDeepSearching` and logic to handle the incoming `search-found` events.

- [ ] **Step 2: Implement `triggerDeepSearch` and event listeners**
Bind the UI button to the backend command and update the file list dynamically.

- [ ] **Step 3: Handle cleanup and cancellation**
Ensure search is cancelled and UI reset when navigating or clearing search.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTabs.ts
git commit -m "feat: integrate deep search logic into state management"
```

---

### Task 5: Verification & Polish

- [ ] **Step 1: Verify on a large directory (e.g., node_modules)**
- [ ] **Step 2: Verify cancellation works as expected**
- [ ] **Step 3: Final UI polish and accessibility check**
- [ ] **Step 4: Commit**

```bash
git commit -m "vibe: final verification and polish"
```
