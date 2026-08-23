import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

// Section: general announcement broadcast (mockup frame 1i/1j). Two things
// the mockup shows that this deliberately drops:
// - A target-audience picker (all users / all pharmacies / one warehouse) -
//   the backend endpoint (POST /admin/notifications) only ever sends to
//   every active pharmacy+warehouse account, there's no per-audience
//   filtering to point a picker at without adding new backend logic.
// - A "last 10 notifications" history table - there's no GET endpoint to
//   list previously sent notifications, only the send endpoint exists.
// Both would need new backend work, out of scope for a visual-only pass.
export function AdminNotificationsPage() {
  const { t } = useTranslation();
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const isValid = titleAr.trim() && titleEn.trim() && bodyAr.trim() && bodyEn.trim();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isValid) return;

    const confirmed = window.confirm(t('admin.notifications.confirmSend', { title: titleAr.trim() }));
    if (!confirmed) return;

    setError(null);
    setSuccessMessage(null);
    setIsSending(true);
    try {
      const data = await api.sendAdminNotification({
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim(),
        bodyAr: bodyAr.trim(),
        bodyEn: bodyEn.trim(),
      });
      setSuccessMessage(t('admin.notifications.sentSuccess', { count: data.recipientCount }));
      setTitleAr('');
      setTitleEn('');
      setBodyAr('');
      setBodyEn('');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.notifications')}</h1>
      </div>

      <div className="adm-card adm-notify-card">
        <form onSubmit={handleSubmit} className="product-form">
          <div className="adm-notify-grid">
            <label>
              {t('admin.notifications.titleArLabel')}
              <input dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
            </label>
            <label dir="ltr">
              {t('admin.notifications.titleEnLabel')}
              <input dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </label>
          </div>
          <div className="adm-notify-grid">
            <label>
              {t('admin.notifications.bodyArLabel')}
              <textarea dir="rtl" rows={4} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} />
            </label>
            <label dir="ltr">
              {t('admin.notifications.bodyEnLabel')}
              <textarea dir="ltr" rows={4} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
            </label>
          </div>

          {error && <p className="error-text">{error}</p>}
          {successMessage && <p className="adm-notify-success">{successMessage}</p>}

          <button type="submit" className="btn-primary" disabled={isSending || !isValid}>
            {isSending ? t('admin.notifications.sending') : t('admin.notifications.sendButton')}
          </button>
          <p className="adm-table-hint">{t('admin.notifications.sendHint')}</p>
        </form>
      </div>
    </div>
  );
}
