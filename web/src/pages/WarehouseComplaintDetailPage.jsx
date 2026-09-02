import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

function statusBadgeClass(status) {
  if (status === 'resolved') return 'status-delivered';
  if (status === 'closed') return 'status-cancelled';
  return 'status-pending';
}

// Section 3: read-only complaint detail for the warehouse. Shows the pharmacy,
// the full complaint text, the linked order (with a jump to the order screen),
// the status and the admin's response when one exists. No decision controls -
// the warehouse cannot reply or change status.
export function WarehouseComplaintDetailPage() {
  const { t } = useTranslation();
  const { complaintId } = useParams();
  const navigate = useNavigate();

  const [complaint, setComplaint] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const statusLabel = (status) => t(`complaints.status.${status}`);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseComplaintDetail(complaintId);
      setComplaint(data.complaint);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [complaintId]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeSync([REALTIME_EVENTS.COMPLAINT_UPDATED], () => load());

  return (
    <div>
      <button className="wh-detail-back" onClick={() => navigate('/warehouse/complaints')}>
        &larr; {t('complaints.warehouse.backToList')}
      </button>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !complaint ? null : (
        <div className="wh-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="wh-detail-card">
              <div className="wh-detail-header-row">
                <h1>{t('complaints.numberValue', { number: complaint.complaintNumber })}</h1>
                <span className={`status-badge ${statusBadgeClass(complaint.status)}`}>
                  {statusLabel(complaint.status)}
                </span>
              </div>
              <div className="wh-detail-timestamp">
                <span className="wh-reason-badge">{t(`complaints.context.${complaint.contextType}`)}</span>
                {' · '}
                {t('complaints.detail.filedOn', { date: new Date(complaint.createdAt).toLocaleString() })}
              </div>
            </div>

            <div className="wh-detail-card wh-pharmacy-card">
              <div>
                <div className="wh-pharmacy-label">{t('complaints.pharmacyColumn')}</div>
                <div className="wh-pharmacy-name">
                  {withArFallback(complaint.pharmacy?.nameEn, complaint.pharmacy?.nameAr)}
                </div>
                <div className="wh-pharmacy-meta">
                  {[complaint.pharmacy?.phone, complaint.pharmacy?.city].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>

            <div className="wh-detail-card">
              <h2 className="wh-detail-card-title">{complaint.subject}</h2>
              <p className="order-notes" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{complaint.description}</p>
              {complaint.extraDetails && (
                <p className="order-notes" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
                  {t('complaints.detail.extraDetails')}: {complaint.extraDetails}
                </p>
              )}
              {complaint.relatedOrderNumber && (
                <div className="wh-detail-timestamp" style={{ marginTop: 12 }}>
                  {t('complaints.detail.relatedOrder')}{' '}
                  {complaint.relatedOrderId ? (
                    <button
                      className="btn-secondary"
                      onClick={() => navigate(`/warehouse/orders/${complaint.relatedOrderId}`)}
                    >
                      {t('complaints.numberValueOrder', { number: complaint.relatedOrderNumber })}
                    </button>
                  ) : (
                    <span className="wh-num">#{complaint.relatedOrderNumber}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="wh-detail-card">
              <h2 className="wh-detail-card-title">{t('complaints.detail.responseTitle')}</h2>
              {complaint.adminResponse ? (
                <>
                  <p className="order-notes" style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>
                    {complaint.adminResponse}
                  </p>
                  <div className="wh-detail-timestamp">
                    {t('complaints.detail.respondedMeta', {
                      name: complaint.respondedBy?.name ?? '—',
                      date: complaint.respondedAt ? new Date(complaint.respondedAt).toLocaleString() : '—',
                    })}
                  </div>
                </>
              ) : (
                <p className="hint">{t('complaints.detail.noResponseYet')}</p>
              )}
            </div>
            <div className="wh-notice">{t('complaints.warehouse.readOnlyNotice')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
