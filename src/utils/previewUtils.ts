import { FileEntry } from '../types';

export const WEBVIEW_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
export const ENGINE_IMAGE_EXTS = [
    'heic', 'heif', 'psd', 'psb', 'tif', 'tiff', 'exr', 'hdr', 'dds', 'qoi', 'tga', 'pnm', 'pbm', 'pgm',
    'pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'ots',
];
export const IMAGE_EXTS = [...WEBVIEW_IMAGE_EXTS, ...ENGINE_IMAGE_EXTS];
export const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg', 'ogg'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
export const TEXT_EXTS = [
    'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html', 'xml',
    'rs', 'py', 'log', 'ini', 'cfg', 'csv', 'yaml', 'yml', 'toml',
    'sql', 'sh', 'bat', 'ps1', 'php', 'java', 'c', 'cpp', 'h', 'hpp',
    'go', 'rb', 'pl', 'swift', 'kt', 'dart'
];

export const THUMBNAIL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

export const thumbnailUrl = (file: FileEntry, size: number = 256): string =>
    `http://thumbnail.localhost/?path=${encodeURIComponent(file.path)}&s=${size}&m=${file.modified_timestamp}&v=2`;

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
