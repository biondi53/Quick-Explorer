import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';

interface SplashScreenProps {
    finishLoading: () => void;
}

export default function SplashScreen({ finishLoading }: SplashScreenProps) {
    const [isMounted, setIsMounted] = useState(true);

    useEffect(() => {
        // Minimum display time to prevent flickering (e.g. 1.5s)
        const timeout = setTimeout(() => {
            setIsMounted(false);
            setTimeout(finishLoading, 500); // Wait for transition fade out
        }, 1500);

        return () => clearTimeout(timeout);
    }, [finishLoading]);

    return (
        <div
            className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0d0d12] transition-opacity duration-500 ${!isMounted ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
            <div className="relative flex items-center justify-center mb-8">
                {/* Glowing Background Effect */}
                <div className="absolute inset-0 bg-[var(--accent-primary)]/20 blur-[60px] rounded-full animate-pulse" />

                {/* Logo Container */}
                <div className="relative z-10 p-6 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
                    <Rocket size={64} className="text-[var(--accent-primary)] drop-shadow-[0_0_15px_rgba(var(--accent-rgb),0.5)] animate-bounce-subtle" />
                </div>
            </div>

            {/* Title with Gradient */}
            <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-zinc-200 to-zinc-500 mb-2">
                SpeedExplorer
            </h1>

            <p className="text-zinc-500 text-sm font-medium tracking-widest uppercase opacity-60 mb-12">
                High Performance File Manager
            </p>

            {/* Custom Loader */}
            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--accent-primary)] w-full origin-left animate-progress-indeterminate shadow-[0_0_10px_var(--accent-primary)]" />
            </div>
        </div>
    );
}
