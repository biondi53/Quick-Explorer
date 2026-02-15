import type { DiskInfo as GeneratedDiskInfo } from './bindings/DiskInfo';
import type { FileEntry as GeneratedFileEntry } from './bindings/FileEntry';
import type { ClipboardInfo as GeneratedClipboardInfo } from './bindings/ClipboardInfo';
import type { RecycleBinStatus as GeneratedRecycleBinStatus } from './bindings/RecycleBinStatus';

export type DiskInfo = GeneratedDiskInfo;
export type FileEntry = GeneratedFileEntry;
export type ClipboardInfo = GeneratedClipboardInfo;
export type RecycleBinStatus = GeneratedRecycleBinStatus;

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
    generationId: number;
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


export type ColumnWidths = Partial<Record<SortColumn, number>>;

