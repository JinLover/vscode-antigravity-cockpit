/**
 * i18n implementation supporting English and Korean
 */

import * as vscode from 'vscode';
import { en, ko } from './translations';

export type SupportedLocale = 
    | 'en'
    | 'ko';

export const localeDisplayNames: Record<SupportedLocale, string> = {
    'en': 'English',
    'ko': '한국어',
};

interface TranslationMap {
    [key: string]: string;
}

const translations: Record<SupportedLocale, TranslationMap> = {
    'en': en,
    'ko': ko,
};

const localeMapping: Record<string, SupportedLocale> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'ko': 'ko',
    'ko-kr': 'ko',
};

/**
 */
export function normalizeLocaleInput(languageSetting: string): string {
    const trimmed = languageSetting.trim().toLowerCase();
    if (!trimmed) {
        return languageSetting;
    }
    if (trimmed === 'auto') {
        return 'auto';
    }
    if (localeMapping[trimmed]) {
        return localeMapping[trimmed];
    }
    const prefix = trimmed.split('-')[0];
    if (localeMapping[prefix]) {
        return localeMapping[prefix];
    }
    return trimmed;
}

class I18nService {
    private currentLocale: SupportedLocale = 'en';
    private manualLocale: string = 'auto';

    constructor() {
        this.detectLocale();
    }

    /**
     */
    private detectLocale(): void {
        const vscodeLocale = vscode.env.language.toLowerCase();
        
        if (localeMapping[vscodeLocale]) {
            this.currentLocale = localeMapping[vscodeLocale];
            return;
        }
        
        const langPrefix = vscodeLocale.split('-')[0];
        if (localeMapping[langPrefix]) {
            this.currentLocale = localeMapping[langPrefix];
            return;
        }
        
        this.currentLocale = 'en';
    }

    /**
     */
    applyLanguageSetting(languageSetting: string): boolean {
        const previousLocale = this.currentLocale;
        this.manualLocale = languageSetting;
        
        if (languageSetting === 'auto') {
            this.detectLocale();
        } else {
            const supportedLocales = Object.keys(translations) as SupportedLocale[];
            if (supportedLocales.includes(languageSetting as SupportedLocale)) {
                this.currentLocale = languageSetting as SupportedLocale;
            } else {
                this.detectLocale();
            }
        }

        return this.currentLocale !== previousLocale;
    }

    /**
     */
    getManualLocale(): string {
        return this.manualLocale;
    }

    /**
     */
    t(key: string, params?: Record<string, string | number>): string {
        const translation = translations[this.currentLocale]?.[key] 
            || translations['en'][key] 
            || key;

        if (!params) {
            return translation;
        }

        return Object.entries(params).reduce(
            (text, [paramKey, paramValue]) => 
                text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
            translation,
        );
    }

    /**
     */
    getLocale(): SupportedLocale {
        return this.currentLocale;
    }

    /**
     */
    setLocale(locale: SupportedLocale): void {
        this.currentLocale = locale;
    }

    /**
     */
    getAllTranslations(): TranslationMap {
        return { ...translations['en'], ...translations[this.currentLocale] };
    }

    /**
     */
    getSupportedLocales(): SupportedLocale[] {
        return Object.keys(translations) as SupportedLocale[];
    }

    /**
     */
    getLocaleDisplayName(locale: SupportedLocale): string {
        return localeDisplayNames[locale] || locale;
    }
}

export const i18n = new I18nService();

export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
