import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatPriceWithSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

const EMPTY_FORM = {
  productId: '',
  titleAr: '',
  titleEn: '',
  discountPercentage: '',
  startDate: '',
  endDate: '',
};

function CreateOfferModal({ products, usdToSyp, onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!form.productId || !form.titleAr.trim() || !form.titleEn.trim() || !form.startDate || !form.endDate) {
      setError(t('common.requiredFields'));
      return;
    }
    const discountPercentage = Number(form.discountPercentage);
    if (!Number.isFinite(discountPercentage) || discountPercentage <= 0 || discountPercentage > 100) {
      setError(t('offers.warehouse.discountRange'));
      return;
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      setError(t('common.endAfterStart'));
      return;
    }

    setIsSaving(true);
    try {
      await api.createWarehouseOffer({
        productId: form.productId,
        titleAr: form.titleAr.trim(),
        titleEn: form.titleEn.trim(),
        discountPercentage,
        startDate: form.startDate,
        endDate: form.endDate,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('offers.warehouse.modalTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('orderDetail.product')}
            <select value={form.productId} onChange={(e) => setField('productId', e.target.value)} required>
              <option value="" disabled>
                {t('offers.warehouse.selectProduct')}
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {withArFallback(product.nameEn, product.nameAr)} (
                  {formatPriceWithSyp(product.priceUsd, usdToSyp)})
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              {t('offers.warehouse.titleEn')}
              <input value={form.titleEn} onChange={(e) => setField('titleEn', e.target.value)} required />
            </label>
            <label>
              {t('offers.warehouse.titleAr')}
              <input
                value={form.titleAr}
                onChange={(e) => setField('titleAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
          </div>
          <label>
            {t('offers.warehouse.discountPercentage')}
            <input
              type="number"
              min="1"
              max="100"
              value={form.discountPercentage}
              onChange={(e) => setField('discountPercentage', e.target.value)}
              required
            />
          </label>
          <div className="form-row">
            <label>
              {t('common.startDate')}
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
                required
              />
            </label>
            <label>
              {t('common.endDate')}
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
                required
              />
            </label>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('offers.warehouse.submitting') : t('offers.warehouse.submitForApproval')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WarehouseOffersPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

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

  const handleCreated = () => {
    setShowCreate(false);
    load();
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.offers')}</h1>
        <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => setShowCreate(true)}>
          {t('offers.warehouse.newOffer')}
        </button>
      </div>

      <p className="wh-notice">{t('offers.warehouse.approvalNotice')}</p>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : offers.length === 0 ? (
        <p className="hint">{t('offers.warehouse.noOffers')}</p>
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
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    {withArFallback(offer.productNameEn, offer.productNameAr)}
                    <div className="wh-table-sub">{offer.titleEn}</div>
                  </td>
                  <td className="wh-num" style={{ color: 'var(--wh-orange)', fontWeight: 700 }}>
                    {offer.discountPercentage}%
                  </td>
                  <td className="wh-num wh-table-date">{new Date(offer.startDate).toLocaleDateString()}</td>
                  <td className="wh-num wh-table-date">{new Date(offer.endDate).toLocaleDateString()}</td>
                  <td>
                    <span
                      className={`status-badge ${offer.status === 'approved' ? 'status-delivered' : 'status-pending'}`}
                    >
                      {statusLabel(offer)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateOfferModal
          products={products}
          usdToSyp={usdToSyp}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
