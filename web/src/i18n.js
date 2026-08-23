import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ar from './locales/ar/translation.json';
import en from './locales/en/translation.json';

const LANG_STORAGE_KEY = 'phoenix_lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    fallbackLng: 'ar',
    supportedLngs: ['ar', 'en'],
    detection: {
      order: ['localStorage'],
      lookupLocalStorageKey: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

// RTL/LTR follows the active language directly (no reload) - centralized
// here rather than in each panel header, so it applies no matter where the
// language is changed from.
function applyDirection(language) {
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = language;
}

applyDirection(i18n.language);
i18n.on('languageChanged', applyDirection);

export default i18n;
