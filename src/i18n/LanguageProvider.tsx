import React, { createContext, useState, useCallback, useMemo } from 'react';
import { en } from './en';
import { es } from './es';
import { Language } from './types';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (path: string, variables?: Record<string, string>) => string;
}

// Internal helper for deep access
const getDeepValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<Language>(() => {
        const saved = localStorage.getItem('speedexplorer-language');
        return (saved as Language) || 'auto';
    });

    const activeLanguage = useMemo(() => {
        if (language === 'auto') {
            return navigator.language.startsWith('es') ? 'es' : 'en';
        }
        return language;
    }, [language]);

    const setLanguage = useCallback((lang: Language) => {
        setLanguageState(lang);
        localStorage.setItem('speedexplorer-language', lang);
    }, []);

    const t = useCallback((path: string, variables?: Record<string, string>): string => {
        const dictionary = activeLanguage === 'es' ? es : en;
        let value = getDeepValue(dictionary, path);
        if (!value) return path;

        if (variables) {
            Object.entries(variables).forEach(([key, val]) => {
                value = value.replace(`{${key}}`, val);
            });
        }
        return value;
    }, [activeLanguage]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};
