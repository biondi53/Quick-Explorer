import { FileEntry } from '../types';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
export const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg', 'ogg'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
export const TEXT_EXTS = [
    'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html',
    'rs', 'py', 'log', 'ini', 'cfg', 'csv', 'yaml', 'yml', 'toml',
    'sql', 'sh', 'bat', 'ps1', 'php', 'java', 'c', 'cpp', 'h', 'hpp',
    'go', 'rb', 'pl', 'swift', 'kt', 'dart'
];

export const isPreviewable = (file: FileEntry | null): boolean => {
    if (!file || file.is_dir) return false;

    const ext = file.path.split('.').pop()?.toLowerCase() || '';

    return (
        IMAGE_EXTS.includes(ext) ||
        VIDEO_EXTS.includes(ext) ||
        AUDIO_EXTS.includes(ext) ||
        TEXT_EXTS.includes(ext)
    );
};
