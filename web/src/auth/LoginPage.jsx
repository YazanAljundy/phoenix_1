import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [step, setStep] = useState('phone'); // phone | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSendCode = async (event) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.sendOtp(phone.trim());
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(phone.trim(), code.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="brand">Phoenix Admin</h1>

        {step === 'phone' ? (
          <form onSubmit={handleSendCode}>
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              autoFocus
            />
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send verification code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <p className="hint">A 6-digit code was sent to {phone}</p>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              autoFocus
            />
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying...' : 'Log in'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setStep('phone');
                setError(null);
              }}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
