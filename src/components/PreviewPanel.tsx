import { File as FileIcon, Image as ImageIcon } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';

import { FileEntry } from '../types';

interface PreviewPanelProps {
    selectedFile: FileEntry | null;
}

export default function PreviewPanel({ selectedFile }: PreviewPanelProps) {
    if (!selectedFile) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 bg-zinc-900 border-l border-zinc-800">
                <ImageIcon size={64} className="mb-4 opacity-50" />
                <p className="text-lg font-medium">Select an image to preview</p>
            </div>
        );
    }

    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i.test(selectedFile.name);

    return (
        <div className="h-full flex flex-col bg-zinc-900 border-l border-zinc-800">
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
                <h2 className="text-lg font-semibold text-zinc-100 truncate">{selectedFile.name}</h2>
                <p className="text-sm text-zinc-400 mt-1 space-x-2">
                    <span>{selectedFile.is_dir ? 'Directory' : 'File'}</span>
                    {!selectedFile.is_dir && <span>• {(selectedFile.size / 1024).toFixed(1)} KB</span>}
                </p>
            </div>

            <div className="flex-1 flex items-center justify-center p-6 overflow-hidden bg-zinc-950/50">
                {selectedFile.is_dir ? (
                    <div className="text-center text-zinc-500">
                        <FileIcon size={64} className="mb-4 mx-auto opacity-50" />
                        <p>Directory preview not supported</p>
                    </div>
                ) : isImage ? (
                    <img
                        src={`${convertFileSrc(selectedFile.path)}?t=${selectedFile.modified_timestamp}`}
                        alt={selectedFile.name}
                        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg border border-zinc-800"
                    />
                ) : (
                    <div className="text-center text-zinc-500">
                        <FileIcon size={64} className="mb-4 mx-auto opacity-50" />
                        <p>No preview available</p>
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-900 text-xs text-zinc-500 font-mono break-all">
                {selectedFile.path}
            </div>
        </div>
    );
}
