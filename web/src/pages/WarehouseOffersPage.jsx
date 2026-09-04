import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { OfferModal } from '../components/OfferModal';
import { withArFallback } from '../utils/displayName';
import { OFFER_FILTERS, filterOffers, offerEditSource, reviewCount } from './offersFilters';

export function WarehouseOffersPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // null = closed, 'new' = create, otherwise the offer being edited.
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [discountMin, setDiscountMin] = useState('');
  const [discountMax, setDiscountMax] = useState('');

  const statusLabel = (offer) =>
    offer.status === 'approved' ? t('offers.warehouse.statusApproved') : t('offers.warehouse.statusPending');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [offersData, productsData] = await Promise.all([api.warehouseOffers(), api.warehouseProducts()]);
      setOffers(offersData.offers);
      setProducts(productsData.products);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleOffers = useMemo(
    () => filterOffers(offers, { status: statusFilter, search, discountMin, discountMax }),
    [offers, statusFilter, search, discountMin, discountMax]
  );
  const pendingCount = useMemo(() => reviewCount(offers), [offers]);

  const handleSaved = () => {
    setEditing(null);
    load();
  };

  const handleDelete = async (offer) => {
    if (!window.confirm(t('offers.warehouse.confirmDelete'))) return;
    setBusyId(offer.id);
    setError(null);
    try {
      await api.deleteWarehouseOffer(offer.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const periodCell = (offer) =>
    offer.isPermanent ? (
      <span className="wh-badge-permanent">{t('offers.warehouse.permanentLabel')}</span>
    ) : (
      new Date(offer.endDate).toLocaleDateString()
    );

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.offers')}</h1>
        <button
          className="btn-primary"
          style={{ width: 'auto', marginTop: 0 }}
          onClick={() => setEditing('new')}
        >
          {t('offers.warehouse.newOffer')}
        </button>
      </div>

      <p className="wh-notice">{t('offers.warehouse.approvalNotice')}</p>

      <div className="wh-pills">
        {OFFER_FILTERS.map((value) => (
          <button
            key={value}
            className={`wh-pill${statusFilter === value ? ' active' : ''}`}
            onClick={() => setStatusFilter(value)}
          >
            {value === 'review'
              ? t('offers.filters.review', { count: pendingCount })
              : t(`offers.filters.${value}`)}
          </button>
        ))}
      </div>

      <div className="wh-filters">
        <input
          type="search"
          className="wh-filter-search"
          placeholder={t('offers.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="number"
          min="1"
          max="100"
          className="wh-filter-num"
          placeholder={t('offers.discountMin')}
          value={discountMin}
          onChange={(e) => setDiscountMin(e.target.value)}
        />
        <input
          type="number"
          min="1"
          max="100"
          className="wh-filter-num"
          placeholder={t('offers.discountMax')}
          value={discountMax}
          onChange={(e) => setDiscountMax(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : offers.length === 0 ? (
        <p className="hint">{t('offers.warehouse.noOffers')}</p>
      ) : visibleOffers.length === 0 ? (
        <p className="hint">{t('offers.noneMatchFilter')}</p>
      ) : (
        <div className="wh-card table-scroll">
          <table className="wh-table">
            <thead>
              <tr>
                <th>{t('orderDetail.product')}</th>
                <th>{t('offers.warehouse.discountPercentage')}</th>
                <th>{t('offers.warehouse.fromColumn')}</th>
                <th>{t('offers.warehouse.toColumn')}</th>
                <th>{t('common.status')}</th>
                <th aria-label={t('common.edit')}></th>
              </tr>
            </thead>
            <tbody>
              {visibleOffers.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    {withArFallback(offer.productNameEn, offer.productNameAr)}
                    <div className="wh-table-sub">{offer.titleEn}</div>
                  </td>
                  <td className="wh-num" style={{ color: 'var(--wh-orange)', fontWeight: 700 }}>
                    {offer.discountPercentage}%
                  </td>
                  <td className="wh-num wh-table-date">{new Date(offer.startDate).toLocaleDateString()}</td>
                  <td className="wh-num wh-table-date">{periodCell(offer)}</td>
                  <td>
                    <span
                      className={`status-badge ${offer.status === 'approved' ? 'status-delivered' : 'status-pending'}`}
                    >
                      {statusLabel(offer)}
                    </span>
                    {offer.pendingUpdate && (
                      <div className="wh-badge-review">{t('offers.warehouse.updatePendingBadge')}</div>
                    )}
                  </td>
                  <td>
                    <div className="table-row-actions">
                      <button className="btn-secondary" onClick={() => setEditing(offer)}>
                        {t('common.edit')}
                      </button>
                      <button
                        className="btn-reject"
                        disabled={busyId === offer.id}
                        onClick={() => handleDelete(offer)}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <OfferModal
          mode={editing === 'new' ? 'create' : 'edit'}
          offer={editing === 'new' ? null : offerEditSource(editing)}
          products={products}
          usdToSyp={usdToSyp}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onSubmit={(payload) =>
            editing === 'new'
              ? api.createWarehouseOffer(payload)
              : api.updateWarehouseOffer(editing.id, payload)
          }
        />
      )}
    </div>
  );
}
