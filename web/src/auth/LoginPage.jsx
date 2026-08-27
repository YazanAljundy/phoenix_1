import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

// Section 6-2/3: phone + password, no OTP (temporarily disabled - see
// AuthContext.login). Single-step form, same shape as the pharmacy app's
// password-login screen.
export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(phone.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img className="auth-logo" src="/images/feniq_logo.png" alt={t('app.brand')} />
        <h1 className="brand">{t('app.brand')}</h1>

        <form onSubmit={handleSubmit}>
          <label htmlFor="phone">{t('auth.phoneLabel')}</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password">{t('auth.passwordLabel')}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? t('auth.loggingIn') : t('auth.logIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
