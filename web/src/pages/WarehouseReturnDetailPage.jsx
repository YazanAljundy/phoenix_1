import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { withArFallback } from '../utils/displayName';

const REASON_KEYS = {
  damaged: 'returns.reasonDamaged',
  wrong_item: 'returns.reasonWrongItem',
  other: 'returns.reasonOther',
};

function statusBadgeClass(returnRequest) {
  if (returnRequest.status === 'approved') return 'status-delivered';
  if (returnRequest.status === 'rejected') return 'status-cancelled';
  return 'status-pending';
}

// Same normalization as WarehouseOrderDetailPage / the Flutter app's
// whatsapp_launcher.dart - wa.me needs digits only with the country code.
function toWhatsAppNumber(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('963')) return digits;
  if (digits.startsWith('0')) return `963${digits.slice(1)}`;
  return digits;
}

function handleCallPharmacyViaWhatsApp(phone) {
  const number = toWhatsAppNumber(phone);
  if (!number) return;
  window.open(`https://wa.me/${number}`, '_blank', 'noreferrer');
}

// Return detail, reached by clicking a return card on WarehouseReturnsPage.
// Approve/reject reuse the exact same endpoints/confirm-prompt UX as that
// list page; nothing else about that logic changes.
export function WarehouseReturnDetailPage() {
  const { t } = useTranslation();
  const { returnId } = useParams();
  const navigate = useNavigate();
  const [returnRequest, setReturnRequest] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const reasonText = useCallback(
    (item) => {
      if (item.reasonType === 'other' && item.customReason) return item.customReason;
      return REASON_KEYS[item.reasonType] ? t(REASON_KEYS[item.reasonType]) : item.reasonType;
    },
    [t],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseReturnDetail(returnId);
      setReturnRequest(data.return);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [returnId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async () => {
    const confirmed = window.confirm(t('returns.confirmApprove', { number: returnRequest.orderNumber }));
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api.approveReturn(returnRequest.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    const rejectionNote = window.prompt(t('returns.promptReject', { number: returnRequest.orderNumber }));
    if (!rejectionNote || !rejectionNote.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await api.rejectReturn(returnRequest.id, rejectionNote.trim());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button className="wh-detail-back" onClick={() => navigate('/warehouse/returns')}>
        &larr; {t('returnDetail.backToReturns')}
      </button>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !returnRequest ? null : (
        <div className="wh-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="wh-detail-card">
              <div className="wh-detail-header-row">
                <h1>{t('returnDetail.header', { number: returnRequest.orderNumber })}</h1>
                <span className={`status-badge ${statusBadgeClass(returnRequest)}`}>
                  {returnRequest.status === 'approved'
                    ? t('returns.statusApproved')
                    : returnRequest.status === 'rejected'
                      ? t('returns.statusRejected')
                      : t('returns.statusPending')}
                </span>
              </div>
              <div className="wh-detail-timestamp">
                {t('returnDetail.linkedToOrder')}{' '}
                <button
                  className="btn-secondary"
                  onClick={() => navigate(`/warehouse/orders/${returnRequest.orderId}`)}
                >
                  {t('orders.orderNumber', { number: returnRequest.orderNumber })}
                </button>
              </div>
            </div>

            <div className="wh-detail-card wh-pharmacy-card">
              <div>
                <div className="wh-pharmacy-label">{t('orderDetail.pharmacy')}</div>
                <div className="wh-pharmacy-name">
                  {withArFallback(returnRequest.pharmacyNameEn, returnRequest.pharmacyNameAr)}
                </div>
                <div className="wh-pharmacy-meta">{returnRequest.pharmacyPhone}</div>
              </div>
              {returnRequest.pharmacyPhone && (
                <div className="wh-pharmacy-actions">
                  <button
                    className="btn-approve"
                    onClick={() => handleCallPharmacyViaWhatsApp(returnRequest.pharmacyPhone)}
                  >
                    <img src="/images/whatsapp_icon.png" alt="" width="20" height="20" className="btn-icon" />
                    {t('orderDetail.whatsapp')}
                  </button>
                </div>
              )}
            </div>

            <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
              <h2
                className="wh-detail-card-title"
                style={{ padding: '14px 20px', margin: 0, borderBottom: '2px solid var(--wh-border)' }}
              >
                {t('returnDetail.items')}
              </h2>
              <div className="table-scroll">
                <table className="wh-table wh-table-compact">
                  <thead>
                    <tr>
                      <th>{t('orderDetail.product')}</th>
                      <th>{t('orderDetail.qty')}</th>
                      <th>{t('returnDetail.reasonColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnRequest.items.map((item) => (
                      <tr key={item.orderItemId}>
                        <td>{withArFallback(item.productNameEn, item.productNameAr)}</td>
                        <td className="wh-num">{item.quantity}</td>
                        <td>
                          <span className="wh-reason-badge">{reasonText(item)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {returnRequest.notes && (
                <p className="order-notes" style={{ margin: 0, padding: '12px 20px', borderTop: '1px solid #EEE' }}>
                  {t('common.note', { note: returnRequest.notes })}
                </p>
              )}
            </div>

            <div className="wh-detail-card">
              <h2 className="wh-detail-card-title">
                {t('returnDetail.images')}{' '}
                <span className="wh-table-sub" style={{ fontWeight: 400 }}>
                  {t('returnDetail.photosHint')}
                </span>
              </h2>
              {returnRequest.images.length === 0 ? (
                <p className="hint">{t('returnDetail.noImages')}</p>
              ) : (
                <div className="wh-return-photos">
                  {returnRequest.images.map((url) => (
                    <button
                      key={url}
                      type="button"
                      className="return-photo-thumb-button"
                      onClick={() => setLightboxUrl(url)}
                    >
                      <img className="return-photo-thumb" src={url} alt="Return evidence" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {returnRequest.status === 'pending' && (
              <div className="wh-detail-card">
                <h2 className="wh-detail-card-title">{t('returnDetail.decisionTitle')}</h2>
                <p className="hint" style={{ marginBottom: 14 }}>
                  {t('returnDetail.decisionExplainer')}
                </p>
                <div className="wh-detail-actions">
                  <button className="btn-approve" disabled={busy} onClick={handleApprove}>
                    {t('returns.approveReplace')}
                  </button>
                  <button className="btn-reject" disabled={busy} onClick={handleReject}>
                    {t('common.reject')}
                  </button>
                </div>
              </div>
            )}

            {returnRequest.status === 'pending' && (
              <div className="wh-notice">{t('returnDetail.rejectionNoteHint')}</div>
            )}

            {returnRequest.status === 'approved' && (
              <div className="wh-detail-card">
                <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {t('returnDetail.approvedWithReplacement')}
                  <button
                    className="btn-secondary"
                    onClick={() => navigate(`/warehouse/orders/${returnRequest.replacementOrderId}`)}
                  >
                    {t('orders.orderNumber', { number: returnRequest.replacementOrderNumber })}
                  </button>
                </p>
              </div>
            )}

            {returnRequest.status === 'rejected' && (
              <div className="wh-detail-card">
                <p className="order-notes" style={{ margin: 0 }}>
                  {t('returnDetail.rejectedWithReason', { reason: returnRequest.rejectionNote })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div className="modal-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Return evidence" className="return-photo-lightbox-image" />
        </div>
      )}
    </div>
  );
}
