use std::collections::{HashMap, HashSet};
use std::path::{PathBuf, Path};
use tauri::Manager;
use std::sync::Arc;
use std::sync::OnceLock;
use parking_lot::RwLock;
use bincode;
use crate::{APP_HANDLE, FileEntry};
use super::art_core::ART;
use log::{info, error, warn, debug, trace};
use std::fs;
use tauri::Emitter;
use std::time::{Instant, SystemTime, Duration};

pub struct IndexManager {
    // Map of root_path -> ART index
    indices: RwLock<HashMap<String, ART>>,
    // Set of all relative paths in each index for deletion-aware updates
    path_sets: RwLock<HashMap<String, HashSet<String>>>,
    // Timestamps of last full index for each root
    indexed_at: RwLock<HashMap<String, SystemTime>>,
    // Set of roots currently being re-indexed in the background
    reindexing_roots: Arc<RwLock<HashSet<String>>>,
    storage_path: OnceLock<PathBuf>,
}

static INSTANCE: OnceLock<Arc<IndexManager>> = OnceLock::new();

impl IndexManager {
    pub fn global() -> Arc<Self> {
        INSTANCE.get_or_init(|| {
            Arc::new(IndexManager {
                indices: RwLock::new(HashMap::new()),
                path_sets: RwLock::new(HashMap::new()),
                indexed_at: RwLock::new(HashMap::new()),
                reindexing_roots: Arc::new(RwLock::new(HashSet::new())),
                storage_path: OnceLock::new(),
            })
        }).clone()
    }

    fn get_storage_path(&self) -> &PathBuf {
        self.storage_path.get_or_init(|| {
            let base = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
                .join("Quick Explorer");
            let indices_path = base.join("indices");
            let _ = fs::create_dir_all(&indices_path);
            indices_path
        })
    }

    fn get_index_file(&self, root_path: &str) -> PathBuf {
        // Create a safe filename from the path
        let safe_name = root_path.replace(|c: char| !c.is_alphanumeric(), "_");
        self.get_storage_path().join(format!("{}.art", safe_name))
    }

    fn get_meta_file(&self, root_path: &str) -> PathBuf {
        let safe_name = root_path.replace(|c: char| !c.is_alphanumeric(), "_");
        self.get_storage_path().join(format!("{}.meta", safe_name))
    }

    pub fn load_index(&self, root_path: &str) -> bool {
        let file_path = self.get_index_file(root_path);
        if !file_path.exists() {
            return false;
        }

        match fs::read(&file_path) {
            Ok(data) => {
                match bincode::deserialize::<ART>(&data) {
                    Ok(art) => {
                        info!("Loaded index for {} ({} items)", root_path, art.len());
                        let paths: HashSet<String> = art.get_all_paths().into_iter().collect();
                        self.indices.write().insert(root_path.to_string(), art);
                        self.path_sets.write().insert(root_path.to_string(), paths);
                        self.load_meta(root_path);
                        true
                    }
                    Err(e) => {
                        error!("Failed to deserialize index for {}: {}", root_path, e);
                        false
                    }
                }
            }
            Err(e) => {
                error!("Failed to read index file for {}: {}", root_path, e);
                false
            }
        }
    }

    pub fn save_index(&self, root_path: &str) {
        let indices = self.indices.read();
        if let Some(art) = indices.get(root_path) {
            match bincode::serialize(art) {
                Ok(data) => {
                    let file_path = self.get_index_file(root_path);
                    if let Err(e) = fs::write(&file_path, data) {
                        error!("Failed to write index to {}: {}", file_path.display(), e);
                    } else {
                        debug!("Saved index for {} to SSD", root_path);
                    }
                }
                Err(e) => error!("Failed to serialize index for {}: {}", root_path, e),
            }
        }
    }

    fn save_meta(&self, root_path: &str) {
        let meta_file = self.get_meta_file(root_path);
        let now = SystemTime::now();
        match bincode::serialize(&now) {
            Ok(data) => {
                if let Err(e) = fs::write(&meta_file, data) {
                    error!("Failed to write meta file for {}: {}", root_path, e);
                } else {
                    self.indexed_at.write().insert(root_path.to_string(), now);
                }
            }
            Err(e) => error!("Failed to serialize metadata for {}: {}", root_path, e),
        }
    }

    fn load_meta(&self, root_path: &str) {
        let meta_file = self.get_meta_file(root_path);
        if meta_file.exists() {
            if let Ok(data) = fs::read(&meta_file) {
                if let Ok(ts) = bincode::deserialize::<SystemTime>(&data) {
                    self.indexed_at.write().insert(root_path.to_string(), ts);
                    return;
                }
            }
        }
    }

    pub fn check_and_trigger_revalidation(
        &self, 
        root: &str, 
        query: &str,
        nav_id: &str,
        initial_results: Vec<String>,
        window: &tauri::Window
    ) {
        const STALE_THRESHOLD: Duration = Duration::from_secs(3 * 24 * 3600); // 3 days
        
        let is_stale = {
            let times = self.indexed_at.read();
            
            // Resolve the actual key that was used to index this folder
            let mut resolved_root = root.to_string();
            if !times.contains_key(root) {
                 if let Some(parent_key) = self.find_closest_index(root) {
                     resolved_root = parent_key;
                 }
            }

            times.get(&resolved_root)
                .map(|t| t.elapsed().unwrap_or(STALE_THRESHOLD) >= STALE_THRESHOLD)
                .unwrap_or(true) // If no timestamp, assume we should revalidate
        };

        if is_stale {
            let already_running = self.reindexing_roots.read().contains(root);
            if !already_running {
                self.spawn_background_reindex(
                    root.to_string(), 
                    query.to_string(), 
                    nav_id.to_string(), 
                    initial_results, 
                    window.clone()
                );
            }
        }
    }

    fn spawn_background_reindex(
        &self, 
        root: String, 
        query: String, 
        nav_id: String, 
        initial_results: Vec<String>,
        window: tauri::Window
    ) {
        let reindexing_roots = self.reindexing_roots.clone();
        reindexing_roots.write().insert(root.clone());
        let _ = window.emit("deep-search-detail-status", "Re-indexing...");
        
        let manager = Self::global();
        
        std::thread::spawn(move || {
            let _ = window.emit("deep-search-detail-status", "Re-indexing...");
            info!("Background re-indexing started for: {}", root);
            
            // Use correct nav_id for background task so it aborts if user navigates
            let res = manager.index_hdd_path(root.clone(), Some(nav_id.clone()), true, window.clone());
            
            reindexing_roots.write().remove(&root);
            
            if res.is_ok() {
                info!("Background re-indexing finished for: {}", root);
                
                // Diff & Refresh: Re-run search on the now-updated index
                // Note: we don't care about the score here, just the paths
                let results = manager.search(&root, &query, &|| {
                    // Quick check if nav_id still matches
                    if let Some(mutex) = crate::GLOBAL_NAV_ID.get() {
                        if let Ok(current_id) = mutex.lock() {
                            return *current_id != nav_id;
                        }
                    }
                    false
                });

                let new_paths: Vec<String> = results.iter().map(|(p, _)| p.clone()).collect();
                
                // Compare with initial results (simple length check first, then content)
                let changed = new_paths.len() != initial_results.len() ||
                             new_paths.iter().zip(initial_results.iter()).any(|(a, b)| a != b);

                if changed {
                    debug!("Search results changed after re-indexing. Refreshing UI.");
                    // In a production app, we'd wrap this in FileEntry, but here we can just signal a refresh
                    // or emit the new list. For simplicity and to match user's request "refresh list",
                    // we'll emit a special event or use the result event with a hint.
                    // Let's use deep-search-result with a special first element or a different event.
                    
                    // Re-fetch full FileEntry data for the new paths
                    let mut entries = Vec::new();
                    for path_str in new_paths {
                        let path = Path::new(&path_str);
                        if let Ok(entry) = crate::get_file_entry(path) {
                            entries.push(entry);
                        }
                    }
                    
                    // Emit with "replace" hint (frontend needs to handle this)
                    // We'll use a custom event for "replace all results"
                    let _ = window.emit("deep-search-replace", entries);
                }
                
                let _ = window.emit("deep-search-detail-status", "Re-indexing finished");
            } else {
                warn!("Background re-indexing aborted or failed for: {}", root);
                let _ = window.emit("deep-search-detail-status", "");
            }
        });
    }

    fn find_closest_index_no_lock<'a>(&self, indices: &'a HashMap<String, ART>, root_path: &str) -> Option<&'a String> {
        let mut best_match: Option<&String> = None;
        let mut longest_len = 0;
        let root_p = std::path::Path::new(root_path);

        for key in indices.keys() {
            let key_p = std::path::Path::new(key);
            if root_p.starts_with(key_p) && key.len() > longest_len {
                best_match = Some(key);
                longest_len = key.len();
            }
        }
        best_match
    }

    fn find_closest_index(&self, root_path: &str) -> Option<String> {
        let indices = self.indices.read();
        self.find_closest_index_no_lock(&indices, root_path).cloned()
    }

    fn check_parent_indices_on_disk(&self, root_path: &str) -> Option<String> {
        let mut current_path = std::path::Path::new(root_path);
        while let Some(parent) = current_path.parent() {
            current_path = parent;
            let path_str = current_path.to_string_lossy().to_string();
            let file_path = self.get_index_file(&path_str);
            if file_path.exists() {
                return Some(path_str);
            }
        }
        None
    }

    pub fn search(&self, root_path: &str, query: &str, is_cancelled: &dyn Fn() -> bool) -> Vec<(String, f32)> {
        let indices = self.indices.read();
        
        // Find best match in memory
        let index_key = if indices.contains_key(root_path) {
            root_path
        } else {
            match self.find_closest_index_no_lock(&indices, root_path) {
                Some(k) => k,
                None => return Vec::new(),
            }
        };

        if let Some(art) = indices.get(index_key) {
            let results = art.search(query, is_cancelled);
            let root = std::path::Path::new(index_key);
            let target_root = std::path::Path::new(root_path);
            
            results
                .into_iter()
                .filter_map(|(rel, score)| {
                    let full = root.join(&rel);
                    if full.starts_with(target_root) {
                        Some((full.to_string_lossy().to_string(), score))
                    } else {
                        None
                    }
                })
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn ensure_indexed(&self, root_path: String, nav_id: String, window: tauri::Window) -> Result<bool, String> {
        // 1. Check if already in memory (exact match)
        {
            let indices = self.indices.read();
            if indices.contains_key(&root_path) {
                return Ok(false);
            }
        }

        // 2. Check if any parent is in memory
        if let Some(parent_key) = self.find_closest_index(&root_path) {
            info!("Found existing parent index {} in memory for {}", parent_key, root_path);
            return Ok(false);
        }

        // 3. Try loading exact path from SSD
        if self.load_index(&root_path) {
            return Ok(false);
        }

        // 4. Try loading parent path from SSD
        if let Some(parent_key) = self.check_parent_indices_on_disk(&root_path) {
            info!("Found existing parent index {} on disk for {}", parent_key, root_path);
            if self.load_index(&parent_key) {
                return Ok(false);
            }
        }

        // 5. Hardware check: If SSD, we don't necessarily NEED to index (we use jwalk), 
        // but for HDDs, we must index now.
        if crate::is_ssd(&root_path) {
            return Ok(false);
        }

        // 6. Perform Safe Indexing for HDD
        self.index_hdd_path(root_path, Some(nav_id), false, window)?;
        Ok(true)
    }


    fn index_hdd_path(&self, root_path: String, nav_id: Option<String>, is_background: bool, window: tauri::Window) -> Result<(), String> {
        let mut art = ART::new(500); // Max results limit
        let start_time = Instant::now();

        // Notify frontend that we are indexing (only if not a background task to avoid label flickering)
        if !is_background {
            let _ = window.emit("deep-search-detail-status", "Indexing...");
        }
        let _ = window.emit("deep-search-status", "Indexing HDD...");
        
        let mut stack = vec![PathBuf::from(&root_path)];
        let mut count = 0;
        let mut path_set = HashSet::new();

        // Perform indexing directly in the current (worker) thread.
        // We set thread priority now.
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_LOWEST};
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_LOWEST);
        }

        let is_cancelled = || {
            use std::sync::atomic::Ordering;
            if crate::SEARCH_CANCELLED.load(Ordering::SeqCst) {
                eprintln!("[RUST-CRITICAL] SEARCH_CANCELLED flag is TRUE. Aborting.");
                return true;
            }
            if let Some(target_nid) = &nav_id {
                if let Some(mutex) = crate::GLOBAL_NAV_ID.get() {
                    if let Ok(current_id) = mutex.lock() {
                        if *current_id != *target_nid {
                            eprintln!("[RUST-CRITICAL] Nav ID mismatch. Expected {}, got {}. Aborting.", target_nid, *current_id);
                            return true;
                        }
                    }
                }
            }
            false
        };

        while let Some(current_dir) = stack.pop() {
            if is_cancelled() {
                // Restore priority before returning
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_NORMAL};
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL);
                }
                warn!("Indexing aborted for {}", root_path);
                return Err("Indexing cancelled".to_string());
            }

            if let Ok(entries) = fs::read_dir(&current_dir) {
                let mut loop_count = 0;
                for entry in entries.filter_map(Result::ok) {
                    loop_count += 1;
                    
                    // Frequent cancellation check (every 50 items)
                    if loop_count % 50 == 0 {
                        if is_cancelled() {
                            // Restore priority before returning
                            #[cfg(target_os = "windows")]
                            unsafe {
                                use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_NORMAL};
                                let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL);
                            }
                            warn!("Indexing aborted for {} (inner loop check)", root_path);
                            return Err("Indexing cancelled".to_string());
                        }
                    }

                    let path = entry.path();
                    if let Some(path_str) = path.to_str() {
                        // Use relative path for ART index
                        let rel_path = if let Ok(rel) = path.strip_prefix(&root_path) {
                            rel.to_string_lossy().to_string()
                        } else {
                            path_str.to_string()
                        };
                        
                        art.insert(&rel_path, 1.0);
                        path_set.insert(rel_path.clone());
                        count += 1;

                        if path.is_dir() {
                            stack.push(path);
                        }
                    }
                }
            }
        }

        // Restore priority
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_NORMAL};
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL);
        }

        info!("Finished indexing {} ({} items in {:?})", root_path, count, start_time.elapsed());
        self.indices.write().insert(root_path.clone(), art);
        self.path_sets.write().insert(root_path.clone(), path_set);
        self.save_index(&root_path);
        self.save_meta(&root_path);
        let _ = window.emit("deep-search-status", "Search ready");
        
        if !is_background {
            let _ = window.emit("deep-search-detail-status", "Indexing finished");
        }
        
        Ok(())
    }

    pub fn update_folder_entries(&self, folder_path: &str, entries: &[FileEntry]) {
        let roots_to_update: Vec<String> = {
            let indices = self.indices.read();
            indices.keys()
                .filter(|root| folder_path.starts_with(*root))
                .cloned()
                .collect()
        };

        if !roots_to_update.is_empty() {
            let mut indices = self.indices.write();
            let mut path_sets = self.path_sets.write();
            let mut roots_needing_save = Vec::new();
            
            for root in roots_to_update {
                let mut root_changed = false;

                match (indices.get_mut(&root), path_sets.get_mut(&root)) {
                    (Some(art), Some(path_set)) => {
                        let root_path = Path::new(&root);
                        let folder_rel = Path::new(folder_path)
                            .strip_prefix(root_path)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_default();

                        // 1. Build set of currently seen names in this folder
                        let current_names: HashSet<String> = entries.iter()
                            .map(|e| e.name.clone())
                            .collect();

                        // 2. Identify stale entries by checking the immediate component after prefix
                        let mut stale_to_remove = Vec::new();
                        
                        // We need a set of "top-level" components currently in the index for this folder
                        let mut indexed_components = HashSet::new();
                        let prefix = if folder_rel.is_empty() { 
                            String::new() 
                        } else if folder_rel.ends_with('\\') || folder_rel.ends_with('/') {
                            folder_rel.clone()
                        } else {
                            folder_rel.clone() + "\\"
                        };

                        for p in path_set.iter().filter(|p| p.starts_with(&prefix)) {
                            let remainder = &p[prefix.len()..];
                            if remainder.is_empty() { continue; }
                            
                            // Get the first part (e.g., "folder" from "folder/file.txt")
                            let component = match remainder.find(|c| c == '/' || c == '\\') {
                                Some(idx) => &remainder[..idx],
                                None => remainder,
                            };
                            indexed_components.insert(component.to_string());
                        }

                        for comp in indexed_components {
                            if !current_names.contains(&comp) {
                                // This component (file or folder) is gone. 
                                // Prune it and everything under it.
                                let comp_prefix = if prefix.is_empty() {
                                    comp.clone()
                                } else {
                                    prefix.clone() + &comp
                                };
                                
                                // Simple file match or folder prefix match
                                stale_to_remove.push(comp_prefix.clone());
                                
                                // Also find all descendants
                                let dir_prefix1 = comp_prefix.clone() + "/";
                                let dir_prefix2 = comp_prefix.clone() + "\\";
                                
                                let descendants: Vec<String> = path_set.iter()
                                    .filter(|p| p.starts_with(&dir_prefix1) || p.starts_with(&dir_prefix2))
                                    .cloned()
                                    .collect();
                                stale_to_remove.extend(descendants);
                            }
                        }

                        if !stale_to_remove.is_empty() {
                            for s in &stale_to_remove {
                                art.remove(s);
                                path_set.remove(s);
                                trace!("Removed stale index entry: {}", s);
                            }
                            root_changed = true;
                            debug!("Sync-update index for {}: removed {} total entries from {} due to missing components", 
                                root, stale_to_remove.len(), folder_path);
                        }

                        // 3. Build set of currently seen relative paths (for new entries)
                        let new_rel_paths: HashSet<String> = entries.iter()
                            .filter_map(|e| Path::new(&e.path).strip_prefix(root_path).ok()
                                .map(|r| r.to_string_lossy().to_string()))
                            .collect();

                        // 4. Update/Insert new entries
                        for r in new_rel_paths {
                            if path_set.insert(r.clone()) {
                                art.insert(&r, 1.0);
                                root_changed = true;
                            }
                        }
                    }
                    (Some(art), None) => {
                        // Fix 1: Graceful degradation if path_set is missing
                        warn!("path_set missing for root '{}', degrading to insert-only update", root);
                        for entry in entries {
                            if let Ok(rel) = Path::new(&entry.path).strip_prefix(Path::new(&root)) {
                                art.insert(&rel.to_string_lossy(), 1.0);
                                root_changed = true;
                            }
                        }
                    }
                    _ => {}
                }

                if root_changed {
                    roots_needing_save.push(root.clone());
                }
            }

            drop(indices);
            drop(path_sets);

            for root in roots_needing_save {
                self.save_index(&root);
                debug!("Persisted updated index for {} after sync-update", root);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_index_persistence() {
        let manager = IndexManager::global();
        let test_root = "D:/Test_Project_Verification";
        
        // 1. Create a dummy index with relative paths
        let mut art = ART::new(10);
        art.insert("src/main.rs", 0.9);
        art.insert("README.md", 0.1);
        
        // 2. Put in manager and save
        manager.indices.write().insert(test_root.to_string(), art);
        manager.save_index(test_root);
        
        // 3. Remove from memory
        manager.indices.write().remove(test_root);
        assert!(!manager.indices.read().contains_key(test_root));
        
        // 4. Load from disk
        assert!(manager.load_index(test_root));
        assert!(manager.indices.read().contains_key(test_root));
        
        // 5. Verify search results
        let results = manager.search(test_root, "src/main", &|| false);
        assert_eq!(results.len(), 1);
        let normalized_result = results[0].0.replace("\\", "/");
        assert_eq!(normalized_result, "D:/Test_Project_Verification/src/main.rs");
        
        // 6. Cleanup
        let index_file = manager.get_index_file(test_root);
        let _ = std::fs::remove_file(index_file);
    }

    #[test]
    fn test_search_cancellation_logic() {
        use std::sync::atomic::Ordering;
        
        // Ensure flag is reset
        crate::SEARCH_CANCELLED.store(false, Ordering::SeqCst);
        
        let nav_id = "test_nav_123".to_string();
        
        // Define the same closure logic as in index_manager.rs
        let is_cancelled = || {
            if crate::SEARCH_CANCELLED.load(Ordering::SeqCst) {
                return true;
            }
            if let Some(mutex) = crate::GLOBAL_NAV_ID.get() {
                if let Ok(current_id) = mutex.lock() {
                    return *current_id != nav_id;
                }
            }
            false
        };

        // 1. Initially not cancelled
        assert!(!is_cancelled());

        // 2. Cancel via atomic flag
        crate::SEARCH_CANCELLED.store(true, Ordering::SeqCst);
        assert!(is_cancelled());

        // 3. Reset and check navigation ID mismatch
        crate::SEARCH_CANCELLED.store(false, Ordering::SeqCst);
        // Set a different GLOBAL_NAV_ID
        if let Ok(mut current_id) = crate::get_nav_id_mutex().lock() {
            *current_id = "different_nav_id".to_string();
        }
        assert!(is_cancelled());
        
        // 4. Set matching GLOBAL_NAV_ID
        if let Ok(mut current_id) = crate::get_nav_id_mutex().lock() {
            *current_id = nav_id.clone();
        }
        assert!(!is_cancelled());
    }

    #[test]
    fn test_subfolder_orphan_cleanup() {
        let manager = IndexManager::global();
        let test_root = "C:/TestRoot";
        
        let mut art = ART::new(10);
        let mut path_set = HashSet::new();
        
        // Setup initial index: a folder with 2 files inside
        let files = vec![
            "folder/file1.txt",
            "folder/file2.txt",
            "other.txt",
        ];
        
        for f in &files {
            art.insert(f, 1.0);
            path_set.insert(f.to_string());
        }
        
        manager.indices.write().insert(test_root.to_string(), art);
        manager.path_sets.write().insert(test_root.to_string(), path_set);
        
        // Simulate navigating to "C:/TestRoot" where "folder" was deleted
        // The entries received from the filesystem only show "other.txt"
        let current_entries = vec![
            FileEntry {
                name: "other.txt".to_string(),
                path: "C:/TestRoot/other.txt".to_string(),
                is_dir: false,
                size: 0,
                formatted_size: "0 B".to_string(),
                file_type: "Text Document".to_string(),
                created_at: "".to_string(),
                modified_at: "".to_string(),
                is_shortcut: false,
                disk_info: None,
                modified_timestamp: 0,
                created_timestamp: 0,
                dimensions: None,
            }
        ];
        
        manager.update_folder_entries(test_root, &current_entries);
        
        // Verify results
        let results = manager.search(test_root, "file1", &|| false);
        // EXPECTED RED: It will fail because Fix 3 is missing (only direct children are removed)
        assert!(results.is_empty(), "file1.txt should have been removed along with its parent folder 'folder'");
        
        let results2 = manager.search(test_root, "other", &|| false);
        assert_eq!(results2.len(), 1, "other.txt should still exist");
    }

    #[test]
    fn test_deletion_persistence() {
        let manager = IndexManager::global();
        let test_root = "C:/PersistTest";
        
        // 1. Initial setup
        let mut art = ART::new(10);
        let mut path_set = HashSet::new();
        art.insert("delete_me.txt", 1.0);
        path_set.insert("delete_me.txt".to_string());
        
        manager.indices.write().insert(test_root.to_string(), art);
        manager.path_sets.write().insert(test_root.to_string(), path_set);
        manager.save_index(test_root);
        
        // 2. Perform deletion update
        let empty_entries = vec![];
        manager.update_folder_entries(test_root, &empty_entries);
        
        // 3. Verify in memory
        assert!(manager.search(test_root, "delete_me", &|| false).is_empty());
        
        // 4. Force reload from disk
        manager.indices.write().remove(test_root);
        manager.path_sets.write().remove(test_root);
        assert!(manager.load_index(test_root));
        
        // 5. Verify results from disk
        // EXPECTED RED: It will fail because Fix 2 is missing (update didn't save to disk)
        let results = manager.search(test_root, "delete_me", &|| false);
        assert!(results.is_empty(), "Deletion should have been persisted to disk");
        
        // Cleanup
        let index_file = manager.get_index_file(test_root);
        let _ = std::fs::remove_file(index_file);
    }

    #[test]
    fn test_stale_detection() {
        let manager = IndexManager::global();
        let test_root = "C:/StaleTest";
        
        // 1. Setup metadata with a timestamp from 4 days ago
        let four_days_ago = SystemTime::now() - Duration::from_secs(4 * 24 * 3600);
        let meta_file = manager.get_meta_file(test_root);
        let data = bincode::serialize(&four_days_ago).unwrap();
        fs::write(&meta_file, data).unwrap();
        
        // 2. Load into manager
        manager.load_meta(test_root);
        
        // 3. Verify detection
        {
            let times = manager.indexed_at.read();
            let ts = times.get(test_root).expect("Timestamp should be loaded");
            let elapsed = ts.elapsed().unwrap();
            assert!(elapsed >= Duration::from_secs(3 * 24 * 3600), "Should be older than 3 days");
        }
        
        // Cleanup
        let _ = fs::remove_file(meta_file);
    }
}
