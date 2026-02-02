export interface DiskInfo {
    total_space: number;
    available_space: number;
}

export interface FileEntry {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    formatted_size: string;
    file_type: string;
    created_at: string;
    modified_at: string;
    is_shortcut: boolean;
    disk_info: DiskInfo | null;
    modified_timestamp: number;
    dimensions?: string;
}

export type SortColumn = 'name' | 'modified_at' | 'created_at' | 'file_type' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
    column: SortColumn;
    direction: SortDirection;
}

export type ViewMode = 'list' | 'grid';

export interface Tab {
    id: string;
    path: string;
    history: string[];
    historyIndex: number;
    files: FileEntry[];
    selectedFiles: FileEntry[];
    lastSelectedFile: FileEntry | null;
    searchQuery: string;
    loading: boolean;
    error: string | null;
    viewMode: ViewMode;
    sortConfig: SortConfig;
    renamingPath: string | null;
}

export interface ClipboardInfo {
    has_files: boolean;
    paths: string[];
    is_cut: boolean;
    file_count: number;
    file_summary: string | null;
    has_image: boolean;
    image_data: string | null;
}

export interface PinnedFolder {
    id: string;
    name: string;
    path: string;
    enabled?: boolean;
}

export interface QuickAccessConfig {
    pinnedFolders: PinnedFolder[];
}

export interface RecycleBinStatus {
    is_empty: boolean;
    item_count: number;
    total_size: number;
}

export type ColumnWidths = Partial<Record<SortColumn, number>>;

