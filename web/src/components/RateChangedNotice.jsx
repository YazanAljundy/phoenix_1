import { useTranslation } from 'react-i18next';
import { formatRate } from '../utils/exchangeRate';

// What a form shows after a RATE_CHANGED refusal: the rate its amounts had been
// converted at, and the one they are converted at now. The form keeps what the
// user typed, its own "≈ $" hints already follow the new rate, and its save
// button turns into the explicit confirmation - nothing is re-sent before
// that. Renders nothing without a change.
export function RateChangedNotice({ rateChange }) {
  const { t } = useTranslation();
  if (!rateChange) return null;

  const suffix = t('common.currencySuffix');
  return (
    <p className="error-text" role="alert">
      {t('exchangeRateChange.notice', {
        from: formatRate(rateChange.from, suffix),
        to: formatRate(rateChange.to, suffix),
      })}
    </p>
  );
}
