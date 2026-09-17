import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import en from '../locales/en/translation.json';
import ar from '../locales/ar/translation.json';
import { RateChangedNotice } from './RateChangedNotice';

// What a form shows after RATE_CHANGED. renderToStaticMarkup needs no DOM, so
// this runs in the project's existing node-environment vitest.

function i18nFor(lng) {
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    lng,
    fallbackLng: lng,
    resources: { en: { translation: en }, ar: { translation: ar } },
    interpolation: { escapeValue: false },
  });
  return instance;
}

function render(lng, rateChange) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18nFor(lng)}>
      <RateChangedNotice rateChange={rateChange} />
    </I18nextProvider>
  );
}

describe('RateChangedNotice', () => {
  it('renders nothing when the rate has not changed', () => {
    expect(render('ar', null)).toBe('');
  });

  it('names the old and the new rate, in Arabic', () => {
    const html = render('ar', { from: 130, to: 135.5 });
    expect(html).toContain('role="alert"');
    expect(html).toContain('تغيّر سعر الصرف');
    expect(html).toContain('130 ل.س');
    expect(html).toContain('135.5 ل.س');
  });

  it('names the old and the new rate, in English', () => {
    const html = render('en', { from: 13000, to: 13250.75 });
    expect(html).toContain('The exchange rate changed');
    expect(html).toContain('13,000 SYP');
    expect(html).toContain('13,250.75 SYP');
  });

  it('shows a dash for a rate it could not read', () => {
    expect(render('en', { from: 130, to: null })).toContain('now —');
  });
});

describe('exchangeRateChange strings', () => {
  it('exist in both languages with the same placeholders', () => {
    for (const locale of [en, ar]) {
      const strings = locale.exchangeRateChange;
      expect(strings.notice).toContain('{{from}}');
      expect(strings.notice).toContain('{{to}}');
      expect(strings.confirmButton.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ar.exchangeRateChange).sort()).toEqual(Object.keys(en.exchangeRateChange).sort());
  });
});
