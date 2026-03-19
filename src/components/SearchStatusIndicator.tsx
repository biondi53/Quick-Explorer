import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '../i18n/useTranslation';

interface SearchStatusIndicatorProps {
  status: string;
}

export const SearchStatusIndicator: React.FC<SearchStatusIndicatorProps> = ({ status }) => {
  const { t } = useTranslation();

  const getStatusText = (s: string) => {
    switch (s) {
      case 'Indexing...': return t('search.indexing');
      case 'Re-indexing...': return t('search.reindexing');
      case 'Searching...': return t('search.searching_status');
      case 'Indexing finished': return t('search.indexing_finished');
      case 'Re-indexing finished': return t('search.reindexing_finished');
      case 'Search finished':
      case 'Finished': return t('search.search_finished');
      default: return s;
    }
  };

  const isFinished = status.includes('finished') || status === 'Finished';
  const text = getStatusText(status);

  if (!status) return null;

  return (
    <div className="flex items-center px-2 py-1.5 h-[34px] min-w-[120px]">
      <motion.span
        initial={{ opacity: 0, x: -10 }}
        animate={{ 
          opacity: 1, 
          x: 0,
        }}
        className={`text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis ${
          isFinished ? 'text-zinc-100' : 'text-[var(--accent-primary)]'
        }`}
      >
        {!isFinished && (
          <motion.span
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            {text}
          </motion.span>
        )}
        {isFinished && text}
      </motion.span>
    </div>
  );
};
