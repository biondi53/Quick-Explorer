import {
    Folder,
    FileText,
    FileImage,
    FileVideo,
    FileAudio,
    FileArchive,
    FileCode,
    File as FileIcon,
    Link as LinkIcon
} from 'lucide-react';

interface FileEntry {
    name: string;
    is_dir: boolean;
    is_shortcut: boolean;
}

export const getIconComponent = (file: FileEntry) => {
    if (file.is_dir) return Folder;
    if (file.is_shortcut) return LinkIcon;

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'];
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg'];
    const audioExts = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
    const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'toml'];
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx'];

    if (imageExts.includes(ext)) return FileImage;
    if (videoExts.includes(ext)) return FileVideo;
    if (audioExts.includes(ext)) return FileAudio;
    if (archiveExts.includes(ext)) return FileArchive;
    if (codeExts.includes(ext)) return FileCode;
    if (docExts.includes(ext)) return FileText;

    return FileIcon;
};
