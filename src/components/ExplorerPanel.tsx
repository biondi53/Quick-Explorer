import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    Folder,
    File,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    RotateCw,
    Home
} from 'lucide-react';

import { FileEntry } from '../types';

interface ExplorerPanelProps {
    initialPath?: string;
    onFileSelect?: (file: FileEntry) => void;
}

export default function ExplorerPanel({ initialPath = 'C:\\', onFileSelect }: ExplorerPanelProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [history, setHistory] = useState<string[]>([initialPath]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadFiles(currentPath);
    }, [currentPath]);

    async function loadFiles(path: string) {
        setLoading(true);
        try {
            setError(null);
            const entries = await invoke<FileEntry[]>('list_files', { path });
            setFiles(entries);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    const navigateTo = (path: string) => {
        if (path === currentPath) return;

        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(path);

        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setCurrentPath(path);
    };

    const handleRowClick = (entry: FileEntry) => {
        if (entry.is_dir) {
            navigateTo(entry.path);
        } else {
            onFileSelect?.(entry);
        }
    };

    const goBack = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setCurrentPath(history[newIndex]);
        }
    };

    const goForward = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setCurrentPath(history[newIndex]);
        }
    };

    const traverseUp = () => {
        const parent = currentPath.split('\\').slice(0, -1).join('\\') || currentPath.split('\\')[0] + '\\';
        if (parent && parent !== currentPath) {
            navigateTo(parent);
        }
    };

    const refresh = () => {
        loadFiles(currentPath);
    };

    const goHome = () => {
        navigateTo(initialPath);
    };

    return (
        <div className="flex flex-col h-full bg-zinc-800 text-zinc-100">
            {/* Navigation Toolbar */}
            <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-700 flex items-center gap-3 shadow-sm z-10">
                <div className="flex items-center gap-1 bg-zinc-800 p-1 rounded-lg border border-zinc-700">
                    <button
                        onClick={goBack}
                        disabled={historyIndex === 0}
                        className="p-1.5 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent rounded-md transition-colors text-zinc-300 hover:text-white"
                        title="Back"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <button
                        onClick={goForward}
                        disabled={historyIndex === history.length - 1}
                        className="p-1.5 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent rounded-md transition-colors text-zinc-300 hover:text-white"
                        title="Forward"
                    >
                        <ArrowRight size={18} />
                    </button>
                    <button
                        onClick={traverseUp}
                        className="p-1.5 hover:bg-zinc-700 rounded-md transition-colors text-zinc-300 hover:text-white"
                        title="Up level"
                    >
                        <ArrowUp size={18} />
                    </button>
                </div>

                <button
                    onClick={goHome}
                    className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
                    title="Home"
                >
                    <Home size={20} />
                </button>

                <div className="flex-1 flex items-center bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500 transition-all">
                    <input
                        type="text"
                        value={currentPath}
                        readOnly
                        className="flex-1 bg-transparent text-sm text-zinc-200 outline-none font-mono placeholder-zinc-600"
                    />
                </div>

                <button
                    onClick={refresh}
                    className={`p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white ${loading ? 'animate-spin' : ''}`}
                    title="Refresh"
                >
                    <RotateCw size={20} />
                </button>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto p-2">
                {error && (
                    <div className="bg-red-950/30 border border-red-900/50 text-red-200 p-4 rounded-xl text-sm mb-4 flex items-center gap-2">
                        <span className="font-bold">Error:</span> {error}
                    </div>
                )}

                <div className="space-y-0.5">
                    {files.map((file) => (
                        <div
                            key={file.path}
                            onClick={() => handleRowClick(file)}
                            className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer select-none transition-all duration-150 ${file.is_dir
                                ? 'hover:bg-zinc-700/80 text-zinc-200'
                                : 'hover:bg-zinc-700/80 text-zinc-300'
                                }`}
                        >
                            <div className="min-w-[24px] flex justify-center text-zinc-400 group-hover:text-zinc-200 transition-colors">
                                {file.is_dir ? (
                                    <Folder size={20} className="fill-blue-500/20 text-blue-400" />
                                ) : (
                                    <File size={20} />
                                )}
                            </div>

                            <span className="truncate text-sm flex-1 font-medium text-zinc-300 group-hover:text-zinc-50 transition-colors">
                                {file.name}
                            </span>

                            {!file.is_dir && (
                                <span className="text-xs text-zinc-500 font-mono w-20 text-right group-hover:text-zinc-400">
                                    {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
