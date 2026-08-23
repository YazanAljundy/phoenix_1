import { useTranslation } from 'react-i18next';

// Shows the language you'd switch TO. Changing it re-renders reactively
// through react-i18next (no reload) and persists to localStorage via the
// i18next-browser-languagedetector cache (see i18n.js); document.dir follows
// along automatically through i18n.js's own languageChanged listener.
export function LanguageToggle() {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === 'ar';

  return (
    <button className="btn-secondary" onClick={() => i18n.changeLanguage(isArabic ? 'en' : 'ar')}>
      {isArabic ? 'EN' : 'AR'}
    </button>
  );
}
