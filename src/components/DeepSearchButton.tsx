import React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/useTranslation';

interface DeepSearchButtonProps {
  onDeepSearch: () => void;
  isSearching: boolean;
  className?: string;
  disabled?: boolean;
}

export const DeepSearchButton: React.FC<DeepSearchButtonProps> = ({
  onDeepSearch,
  isSearching,
  className,
  disabled
}) => {
  const { t } = useTranslation();

  return (
    <button
      onClick={onDeepSearch}
      disabled={disabled}
      title={isSearching ? t('toolbar.deep_search_active') : t('toolbar.deep_search')}
      className={cn(
        "p-2 rounded-lg transition-all",
        isSearching 
          ? "text-white animate-pulse bg-[var(--accent-primary)]/20 shadow-[0_0_12px_rgba(var(--accent-rgb),0.3)]" 
          : "text-zinc-400 hover:text-white hover:bg-zinc-800/80 active:scale-95",
        className
      )}
    >
      <Search size={18} />
    </button>
  );
};
