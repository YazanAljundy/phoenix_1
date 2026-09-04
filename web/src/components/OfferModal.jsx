import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUsdAsSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

// The one form used to create AND edit an offer, on both the warehouse and the
// admin Offers pages - the same "reuse the create form for editing" approach
// AdvertisementModal / ProductFormModal already take.
//
// - `products` given  -> the product is a <select> (the warehouse picks from
//   its own catalog, on create or edit).
// - `products` null   -> the product is shown read-only (the admin edits an
//   existing offer's discount / dates / names, not which product it is on).
//
// `onSubmit(payload)` does the actual API call; the payload is
// { productId, titleAr, titleEn, discountPercentage, startDate, isPermanent }
// plus `endDate` only when it is not a permanent offer.

function toDateInputValue(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function initialForm(offer) {
  if (!offer) {
    return { productId: '', titleAr: '', titleEn: '', discountPercentage: '', startDate: '', endDate: '', isPermanent: false };
  }
  return {
    productId: offer.productId ?? '',
    titleAr: offer.titleAr ?? '',
    titleEn: offer.titleEn ?? '',
    discountPercentage: String(offer.discountPercentage ?? ''),
    startDate: toDateInputValue(offer.startDate),
    endDate: toDateInputValue(offer.endDate),
    isPermanent: Boolean(offer.isPermanent),
  };
}

export function OfferModal({ mode, offer, products, usdToSyp, onClose, onSubmit, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => initialForm(offer));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const isEdit = mode === 'edit';
  const productName = offer ? withArFallback(offer.productNameEn, offer.productNameAr) : '';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!form.productId || !form.titleAr.trim() || !form.titleEn.trim() || !form.startDate) {
      setError(t('common.requiredFields'));
      return;
    }
    const discountPercentage = Number(form.discountPercentage);
    if (!Number.isFinite(discountPercentage) || discountPercentage <= 0 || discountPercentage > 100) {
      setError(t('offers.warehouse.discountRange'));
      return;
    }
    if (!form.isPermanent) {
      if (!form.endDate) {
        setError(t('common.requiredFields'));
        return;
      }
      if (new Date(form.endDate) <= new Date(form.startDate)) {
        setError(t('common.endAfterStart'));
        return;
      }
    }

    const payload = {
      productId: form.productId,
      titleAr: form.titleAr.trim(),
      titleEn: form.titleEn.trim(),
      discountPercentage,
      startDate: form.startDate,
      isPermanent: form.isPermanent,
    };
    if (!form.isPermanent) payload.endDate = form.endDate;

    setIsSaving(true);
    try {
      await onSubmit(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{isEdit ? t('offers.warehouse.editTitle') : t('offers.warehouse.modalTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('orderDetail.product')}
            {products ? (
              <select value={form.productId} onChange={(e) => setField('productId', e.target.value)} required>
                <option value="" disabled>
                  {t('offers.warehouse.selectProduct')}
                </option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {withArFallback(product.nameEn, product.nameAr)} (
                    {formatUsdAsSyp(product.priceUsd, usdToSyp)})
                  </option>
                ))}
              </select>
            ) : (
              <input value={productName} disabled />
            )}
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

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isPermanent}
              onChange={(e) => setField('isPermanent', e.target.checked)}
            />
            {t('offers.warehouse.permanentOffer')}
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
            {form.isPermanent ? (
              <p className="hint">{t('offers.warehouse.permanentOfferHint')}</p>
            ) : (
              <label>
                {t('common.endDate')}
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setField('endDate', e.target.value)}
                  required
                />
              </label>
            )}
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving
                ? t('offers.warehouse.submitting')
                : isEdit
                  ? t('offers.warehouse.saveChanges')
                  : t('offers.warehouse.submitForApproval')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
