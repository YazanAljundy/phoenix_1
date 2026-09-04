import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

const STATUSES = ['pending', 'in_review', 'resolved', 'closed'];

function statusBadgeClass(status) {
  if (status === 'resolved') return 'status-delivered';
  if (status === 'closed') return 'status-cancelled';
  return 'status-pending';
}

// Section 9/10: the admin's complaint detail + reply. Approve/reject-style
// double-submit is prevented by disabling the send button while a request is
// in flight (`busy`).
export function AdminComplaintDetailPage() {
  const { t } = useTranslation();
  const { complaintId } = useParams();
  const navigate = useNavigate();

  const [complaint, setComplaint] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [responseText, setResponseText] = useState('');
  const [targetStatus, setTargetStatus] = useState('resolved');

  const statusLabel = (status) => t(`complaints.status.${status}`);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.adminComplaintDetail(complaintId);
      setComplaint(data.complaint);
      setResponseText(data.complaint.adminResponse ?? '');
      setTargetStatus(
        data.complaint.status === 'pending' ? 'resolved' : data.complaint.status,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [complaintId]);

  useEffect(() => {
    load();
  }, [load]);

  // Another admin acting on the same complaint keeps this view honest.
  useRealtimeSync([REALTIME_EVENTS.COMPLAINT_UPDATED], () => load());

  const handleSendResponse = async (event) => {
    event.preventDefault();
    if (busy || !responseText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.respondToComplaint(complaintId, {
        response: responseText.trim(),
        status: targetStatus,
      });
      setComplaint(data.complaint);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStatusOnly = async (status) => {
    if (busy || status === complaint.status) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.updateComplaintStatus(complaintId, status);
      setComplaint(data.complaint);
      setTargetStatus(data.complaint.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button className="wh-detail-back" onClick={() => navigate('/admin/complaints')}>
        &larr; {t('complaints.admin.backToList')}
      </button>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !complaint ? null : (
        <div className="adm-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="adm-detail-card">
              <div className="wh-detail-header-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <h1 style={{ margin: 0 }}>
                  {t('complaints.numberValue', { number: complaint.complaintNumber })}
                </h1>
                <span className={`status-badge ${statusBadgeClass(complaint.status)}`}>
                  {statusLabel(complaint.status)}
                </span>
              </div>
              <p className="adm-detail-card-hint" style={{ marginTop: 6 }}>
                <span className="adm-tag">{t(`complaints.context.${complaint.contextType}`)}</span>
              </p>
              <p className="adm-detail-card-title" style={{ marginTop: 12 }}>{complaint.subject}</p>
              <p className="adm-detail-card-hint">
                {t('complaints.detail.filedOn', { date: new Date(complaint.createdAt).toLocaleString() })}
              </p>
              <p className="order-notes" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{complaint.description}</p>
              {complaint.extraDetails && (
                <>
                  <p className="adm-detail-card-title" style={{ marginTop: 16, fontSize: 13 }}>
                    {t('complaints.detail.extraDetails')}
                  </p>
                  <p className="order-notes" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{complaint.extraDetails}</p>
                </>
              )}
              {complaint.relatedOrderNumber && (
                <p style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t('complaints.detail.relatedOrder')}
                  {complaint.relatedOrderId ? (
                    <span className="adm-num">
                      {t('complaints.numberValueOrder', { number: complaint.relatedOrderNumber })}
                    </span>
                  ) : (
                    <span className="adm-num">#{complaint.relatedOrderNumber}</span>
                  )}
                </p>
              )}

              {complaint.relatedOrderSealPhoto && (
                <div style={{ marginTop: 12 }}>
                  <p className="adm-detail-card-title" style={{ fontSize: 13 }}>
                    {t('complaints.detail.deliverySealPhoto')}
                  </p>
                  <a href={complaint.relatedOrderSealPhoto} target="_blank" rel="noreferrer">
                    <img
                      src={complaint.relatedOrderSealPhoto}
                      alt={t('complaints.detail.deliverySealPhoto')}
                      style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
                    />
                  </a>
                  {complaint.relatedOrderSealConfirmedAt && (
                    <p className="adm-detail-card-hint" style={{ marginBottom: 0 }}>
                      {t('complaints.detail.deliverySealConfirmedAt', {
                        date: new Date(complaint.relatedOrderSealConfirmedAt).toLocaleString(),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="adm-detail-card">
              <p className="adm-detail-card-title">{t('complaints.pharmacyColumn')}</p>
              <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                {withArFallback(complaint.pharmacy?.nameEn, complaint.pharmacy?.nameAr)}
              </p>
              {complaint.pharmacy?.ownerName && (
                <p className="adm-detail-card-hint" style={{ margin: '0 0 4px' }}>{complaint.pharmacy.ownerName}</p>
              )}
              <p className="adm-detail-card-hint" style={{ margin: 0 }}>
                {[complaint.pharmacy?.phone, complaint.pharmacy?.city].filter(Boolean).join(' · ')}
              </p>
            </div>

            {complaint.warehouse ? (
              <div className="adm-detail-card">
                <p className="adm-detail-card-title">{t('complaints.warehouseColumn')}</p>
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                  {withArFallback(complaint.warehouse.nameEn, complaint.warehouse.nameAr)}
                </p>
                <p className="adm-detail-card-hint" style={{ margin: 0 }}>
                  {[complaint.warehouse.phone, complaint.warehouse.city].filter(Boolean).join(' · ')}
                </p>
              </div>
            ) : (
              <div className="adm-detail-card">
                <p className="adm-detail-card-hint" style={{ margin: 0 }}>
                  {t('complaints.detail.generalNoTargets')}
                </p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {complaint.adminResponse && (
              <div className="adm-detail-card">
                <p className="adm-detail-card-title">{t('complaints.detail.currentResponse')}</p>
                <p className="order-notes" style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>
                  {complaint.adminResponse}
                </p>
                <p className="adm-detail-card-hint" style={{ margin: 0 }}>
                  {t('complaints.detail.respondedMeta', {
                    name: complaint.respondedBy?.name ?? '—',
                    date: complaint.respondedAt ? new Date(complaint.respondedAt).toLocaleString() : '—',
                  })}
                </p>
              </div>
            )}

            <div className="adm-detail-card">
              <p className="adm-detail-card-title">
                {complaint.adminResponse ? t('complaints.detail.updateResponseTitle') : t('complaints.detail.responseTitle')}
              </p>
              <p className="adm-detail-card-hint">{t('complaints.detail.responseHint')}</p>
              <form className="product-form" onSubmit={handleSendResponse}>
                <label>
                  {t('complaints.detail.responseLabel')}
                  <textarea
                    rows={6}
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder={t('complaints.detail.responsePlaceholder')}
                  />
                </label>
                <label>
                  {t('complaints.detail.setStatusLabel')}
                  <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)}>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn-primary" disabled={busy || !responseText.trim()}>
                  {busy ? t('common.saving') : t('complaints.detail.sendButton')}
                </button>
              </form>
            </div>

            <div className="adm-detail-card">
              <p className="adm-detail-card-title">{t('complaints.detail.quickStatusTitle')}</p>
              <div className="adm-row-actions">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="adm-row-action"
                    disabled={busy || status === complaint.status}
                    onClick={() => handleStatusOnly(status)}
                  >
                    {statusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
