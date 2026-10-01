import React from 'react';

interface WindowsIconProps {
    className?: string;
    size?: number;
}

export const WindowsIcon: React.FC<WindowsIconProps> = ({ className = "", size = 16 }) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 88 88"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <defs>
                <linearGradient id="win-logo-gradient" x1="0" y1="0" x2="88" y2="88" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#00adef" />
                    <stop offset="100%" stopColor="#0067b8" />
                </linearGradient>
            </defs>
            <rect x="0" y="0" width="42" height="42" rx="4" fill="url(#win-logo-gradient)" />
            <rect x="46" y="0" width="42" height="42" rx="4" fill="url(#win-logo-gradient)" />
            <rect x="0" y="46" width="42" height="42" rx="4" fill="url(#win-logo-gradient)" />
            <rect x="46" y="46" width="42" height="42" rx="4" fill="url(#win-logo-gradient)" />
        </svg>
    );
};
