import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

export default function WindowControls() {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const updateMaximized = async () => {
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        };

        updateMaximized();
        const unlisten = appWindow.onResized(() => {
            updateMaximized();
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => appWindow.toggleMaximize();
    const handleClose = () => appWindow.close();

    return (
        <div className="flex h-full items-stretch select-none no-drag">
            {/* Minimize */}
            <button
                onClick={handleMinimize}
                className="flex items-center justify-center w-[46px] h-full hover:bg-white/10 transition-colors group"
                title="Minimize"
            >
                <svg width="10" height="1" viewBox="0 0 10 1">
                    <rect width="10" height="1" fill="currentColor" className="text-white group-hover:text-white" />
                </svg>
            </button>

            {/* Maximize/Restore */}
            <button
                onClick={handleMaximize}
                className="flex items-center justify-center w-[46px] h-full hover:bg-white/10 transition-colors group"
                title={isMaximized ? "Restore" : "Maximize"}
            >
                {isMaximized ? (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                        <path
                            d="M2.1,0v2H0v8h8V7.9h2V0H2.1z M7,9H1V3h6V9z M9,6.9H8V2.1h-4.9V1H9V6.9z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            className="text-white group-hover:text-white"
                        />
                    </svg>
                ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                        <rect
                            x="0.5"
                            y="0.5"
                            width="9"
                            height="9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            className="text-white group-hover:text-white"
                        />
                    </svg>
                )}
            </button>

            {/* Close */}
            <button
                onClick={handleClose}
                className="flex items-center justify-center w-[46px] h-full hover:bg-[#e81123] transition-colors group"
                title="Close"
            >
                <svg width="10" height="10" viewBox="0 0 10 10">
                    <path
                        d="M0,0L10,10M10,0L0,10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        className="text-white group-hover:text-white"
                    />
                </svg>
            </button>
        </div>
    );
}
