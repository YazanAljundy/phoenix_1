import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { OfferModal } from '../components/OfferModal';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';
import { OFFER_FILTERS, filterOffers, isInReview, reviewCount } from './offersFilters';

// Section 5/6: the admin's cross-warehouse Offers page. One unpaginated read of
// every offer (api.allOffers), filtered client-side. A row in the moderation
// queue (a new offer, or an approved offer with a parked warehouse edit) gets
// Approve/Reject; every row also gets a direct admin Edit/Delete.
export function AdminOffersPage() {
  const { t } = useTranslation();
  const [offers, setOffers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);

  const [statusFilter, setStatusFilter] = useState('review');
  const [search, setSearch] = useState('');
  const [discountMin, setDiscountMin] = useState('');
  const [discountMax, setDiscountMax] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.allOffers();
      setOffers(data.offers);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A warehouse submitting/editing an offer, and another admin deciding one,
  // both change this list - re-read the authoritative state over HTTP.
  useRealtimeSync([REALTIME_EVENTS.OFFER_PENDING, REALTIME_EVENTS.OFFER_STATUS_UPDATED], () => load());

  const visibleOffers = useMemo(
    () => filterOffers(offers, { status: statusFilter, search, discountMin, discountMax }),
    [offers, statusFilter, search, discountMin, discountMax]
  );
  const pendingCount = useMemo(() => reviewCount(offers), [offers]);

  const runAction = async (offerId, fn) => {
    setBusyId(offerId);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = (offer) => {
    if (!window.confirm(t('offers.admin.confirmApprove', { title: offer.titleEn }))) return;
    runAction(offer.id, () => api.approveOffer(offer.id));
  };

  const handleReject = (offer) => {
    const key = offer.pendingUpdate ? 'offers.admin.confirmRejectUpdate' : 'offers.admin.confirmReject';
    if (!window.confirm(t(key, { title: offer.titleEn }))) return;
    runAction(offer.id, () => api.rejectOffer(offer.id));
  };

  const handleDelete = (offer) => {
    if (!window.confirm(t('offers.admin.confirmDelete', { title: offer.titleEn }))) return;
    runAction(offer.id, () => api.deleteAdminOffer(offer.id));
  };

  const periodText = (o) =>
    o.isPermanent
      ? t('offers.warehouse.permanentLabel')
      : `${new Date(o.startDate).toLocaleDateString()} — ${new Date(o.endDate).toLocaleDateString()}`;

  const handleSaved = () => {
    setEditing(null);
    load();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.offers')}</h1>
        <div className="adm-page-head-meta">{t('offers.admin.rejectionHint')}</div>
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            {OFFER_FILTERS.map((value) => (
              <button
                key={value}
                className={`adm-pill${statusFilter === value ? ' active' : ''}`}
                onClick={() => setStatusFilter(value)}
              >
                {value === 'review'
                  ? t('offers.filters.review', { count: pendingCount })
                  : t(`offers.filters.${value}`)}
              </button>
            ))}
          </div>

          <div className="adm-filters-row">
            <input
              type="search"
              className="adm-filter-search"
              placeholder={t('offers.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              type="number"
              min="1"
              max="100"
              className="adm-filter-num"
              placeholder={t('offers.discountMin')}
              value={discountMin}
              onChange={(e) => setDiscountMin(e.target.value)}
            />
            <input
              type="number"
              min="1"
              max="100"
              className="adm-filter-num"
              placeholder={t('offers.discountMax')}
              value={discountMax}
              onChange={(e) => setDiscountMax(e.target.value)}
            />
          </div>

          {visibleOffers.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#10003;</div>
              <div className="adm-empty-state-title">{t('offers.admin.noOffers')}</div>
            </div>
          ) : (
            <div className="adm-card table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t('offers.admin.warehouseColumn')}</th>
                    <th>{t('offers.admin.productColumn')}</th>
                    <th>{t('offers.admin.discountColumn')}</th>
                    <th>{t('offers.warehouse.fromColumn')}</th>
                    <th>{t('offers.warehouse.toColumn')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('admin.pendingAccounts.actionColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOffers.map((offer) => {
                    const u = offer.pendingUpdate;
                    return (
                      <tr key={offer.id}>
                        <td>{offer.warehouseNameEn}</td>
                        <td>
                          {withArFallback(offer.productNameEn, offer.productNameAr)}
                          <div className="adm-table-sub">{offer.titleEn}</div>
                          {u && (
                            <div className="adm-offer-proposed">
                              {t('offers.admin.proposedLabel')}:{' '}
                              <strong>{withArFallback(u.productNameEn, u.productNameAr)}</strong> — {u.titleEn}
                            </div>
                          )}
                        </td>
                        <td className="adm-num adm-offer-discount">
                          {offer.discountPercentage}%
                          {u && (
                            <div className="adm-offer-proposed">
                              {t('offers.admin.proposedLabel')}: <strong>{u.discountPercentage}%</strong>
                            </div>
                          )}
                        </td>
                        <td className="adm-num">{new Date(offer.startDate).toLocaleDateString()}</td>
                        <td className="adm-num">
                          {offer.isPermanent ? (
                            <span className="adm-badge-permanent">{t('offers.warehouse.permanentLabel')}</span>
                          ) : (
                            new Date(offer.endDate).toLocaleDateString()
                          )}
                          {u && (
                            <div className="adm-offer-proposed">
                              {t('offers.admin.proposedLabel')}: <strong>{periodText(u)}</strong>
                            </div>
                          )}
                        </td>
                        <td>
                          {isInReview(offer) ? (
                            <span className="status-badge status-pending">
                              {u ? t('offers.admin.updateRequestBadge') : t('offers.warehouse.statusPending')}
                            </span>
                          ) : (
                            <span className="status-badge status-delivered">
                              {t('offers.warehouse.statusApproved')}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="adm-row-actions">
                            {isInReview(offer) && (
                              <>
                                <button
                                  className="btn-approve"
                                  disabled={busyId === offer.id}
                                  onClick={() => handleApprove(offer)}
                                >
                                  {t('common.approve')}
                                </button>
                                <button
                                  className="btn-reject"
                                  disabled={busyId === offer.id}
                                  onClick={() => handleReject(offer)}
                                >
                                  {t('common.reject')}
                                </button>
                              </>
                            )}
                            {/* A parked warehouse edit must be decided through
                                Approve/Reject above - the admin never edits
                                directly over it. */}
                            {!offer.pendingUpdate && (
                              <button className="adm-row-action" onClick={() => setEditing(offer)}>
                                {t('common.edit')}
                              </button>
                            )}
                            <button
                              className="adm-row-action adm-row-action-danger"
                              disabled={busyId === offer.id}
                              onClick={() => handleDelete(offer)}
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing && (
        <OfferModal
          mode="edit"
          offer={editing}
          products={null}
          usdToSyp={null}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onSubmit={(payload) => api.updateAdminOffer(editing.id, payload)}
        />
      )}
    </div>
  );
}
