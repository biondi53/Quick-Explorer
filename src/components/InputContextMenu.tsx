import { useEffect, useRef, useLayoutEffect } from 'react';
import { Copy, Scissors, Clipboard, CheckSquare, ArrowRight } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';

interface InputContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onAction: (action: 'cut' | 'copy' | 'paste' | 'select-all' | 'paste-and-go') => void;
    showPasteAndGo?: boolean;
}

export default function InputContextMenu({ x, y, onClose, onAction, showPasteAndGo }: InputContextMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const margin = 12;
            let finalX = x;
            let finalY = y;

            if (x + rect.width > window.innerWidth - margin) {
                finalX = x - rect.width;
            }
            if (y + rect.height > window.innerHeight - margin) {
                finalY = y - rect.height;
            }

            menuRef.current.style.left = `${finalX}px`;
            menuRef.current.style.top = `${finalY}px`;
            menuRef.current.style.opacity = '1';
        }
    }, [x, y]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const items = [
        { id: 'cut' as const, label: t('toolbar.cut') || 'Cut', icon: <Scissors size={20} /> },
        { id: 'copy' as const, label: t('toolbar.copy') || 'Copy', icon: <Copy size={20} /> },
        { id: 'paste' as const, label: t('toolbar.paste') || 'Paste', icon: <Clipboard size={20} /> },
        ...(showPasteAndGo ? [
            { id: 'paste-and-go' as const, label: t('context_menu.paste_and_go'), icon: <ArrowRight size={20} /> }
        ] : []),
        { type: 'separator' },
        { id: 'select-all' as const, label: t('context_menu.select_all') || 'Select All', icon: <CheckSquare size={20} /> },
    ];

    return (
        <div
            ref={menuRef}
            className="fixed z-[100] w-56 bg-[#0f111a]/95 backdrop-blur-3xl border border-white/10 rounded-xl py-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.7),0_0_15px_var(--accent-glow)] animate-in fade-in zoom-in-95 duration-100 ease-out select-none opacity-0"
            style={{ left: x, top: y }}
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
            {items.map((item, idx) => (
                item.type === 'separator' ? (
                    <div key={`sep-${idx}`} className="h-px bg-white/5 my-1 mx-2" />
                ) : (
                    <button
                        key={item.id}
                        onClick={() => {
                            if (item.id) {
                                onAction(item.id as 'cut' | 'copy' | 'paste' | 'select-all' | 'paste-and-go');
                                onClose();
                            }
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-all rounded-lg mx-1 w-[calc(100%-8px)] group hover:bg-[var(--accent-primary)]/20 hover:text-[var(--accent-primary)] text-zinc-300"
                    >
                        <span className="transition-all duration-300 opacity-60 group-hover:opacity-100 group-hover:scale-105">
                            {item.icon}
                        </span>
                        <span className="font-semibold tracking-tight">{item.label}</span>
                    </button>
                )
            ))}
        </div>
    );
}
