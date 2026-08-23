import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { withArFallback } from '../utils/displayName';

export const EMPTY_PRODUCT_FORM = {
  masterProductId: null,
  nameAr: '',
  nameEn: '',
  manufacturerAr: '',
  manufacturerEn: '',
  categoryId: '',
  unitAr: '',
  unitEn: '',
  price: '',
  description: '',
  image: '',
  manuallyDisabled: false,
};

export function productFormFromProduct(product) {
  return {
    masterProductId: product.masterProductId ?? null,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    categoryId: product.categoryId,
    unitAr: product.unitAr ?? '',
    unitEn: product.unitEn ?? '',
    price: String(product.priceUsd),
    description: product.description ?? '',
    image: product.image ?? '',
    manuallyDisabled: product.manuallyDisabled,
  };
}

// Section 7: isAvailable is derived (not manually paused) - the badge
// reflects that. Shared by the warehouse's own product table and the
// admin's cross-warehouse one.
// TODO(re-enable-stock): was also gated on stock > 0, with "Out of stock"
// called out distinctly from "Paused" - quantity tracking is on hold, see
// backend/src/models/product.model.js.
// `t` is threaded in explicitly (not a hook itself) since this runs outside
// component render in some call sites (table cell helpers).
export function productAvailabilityLabel(product, t) {
  return product.manuallyDisabled ? t('products.paused') : t('products.available');
}

export function productAvailabilityClass(product) {
  return product.isAvailable ? 'availability-available' : 'availability-paused';
}

// Section 14 Part 2: a medicine's name/manufacturer are only ever chosen by
// searching the central catalog, never typed - this is the search+select UI
// for that, used only when creating a product (an existing one's link isn't
// re-editable, see ProductFormModal below).
function CatalogSearchField({ onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const data = await api.warehouseCatalogSearch(query.trim());
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <label>
      {t('productForm.searchMedicine')}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('productForm.searchPlaceholder')}
        dir="rtl"
      />
      {isSearching && <p className="hint">{t('productForm.searching')}</p>}
      {results.length > 0 && (
        <ul className="catalog-search-results">
          {results.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSelect(item)}>
                <strong>{item.nameAr}</strong>
                <span className="hint"> — {item.manufacturerAr}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isSearching && query.trim() && results.length === 0 && (
        <p className="hint">{t('productForm.noMatch')}</p>
      )}
    </label>
  );
}

// The form itself is identical whether a warehouse is creating/editing its
// own product or an admin is editing someone else's (Section 13c: admin
// edits/deletes, it never creates) - only WHERE the submission goes differs,
// so that's left entirely to the caller via onSubmit rather than hardcoded
// here.
export function ProductFormModal({ mode, initialForm, categories, usdToSyp, onClose, onSaved, onSubmit }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(initialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleCatalogSelect = (item) => {
    setForm((prev) => ({
      ...prev,
      masterProductId: item.id,
      nameAr: item.nameAr,
      nameEn: item.nameEn,
      manufacturerAr: item.manufacturerAr,
      manufacturerEn: item.manufacturerEn,
    }));
  };

  const handleChangeSelection = () => {
    setForm((prev) => ({
      ...prev,
      masterProductId: null,
      nameAr: '',
      nameEn: '',
      manufacturerAr: '',
      manufacturerEn: '',
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (mode === 'create' && !form.masterProductId) {
      setError(t('productForm.selectMedicineRequired'));
      return;
    }

    const requiredFields = ['unitAr', 'unitEn', 'categoryId'];
    if (requiredFields.some((field) => !form[field].trim())) {
      setError(t('common.requiredFields'));
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setError(t('productForm.pricePositive'));
      return;
    }

    const payload = {
      masterProductId: mode === 'create' ? form.masterProductId : undefined,
      categoryId: form.categoryId,
      unitAr: form.unitAr.trim(),
      unitEn: form.unitEn.trim(),
      priceUsd: price,
      description: form.description.trim() || undefined,
      image: form.image.trim() || undefined,
      manuallyDisabled: form.manuallyDisabled,
    };

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
        <h2>{mode === 'create' ? t('productForm.addTitle') : t('productForm.editTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          {mode === 'create' && !form.masterProductId ? (
            <CatalogSearchField onSelect={handleCatalogSelect} />
          ) : (
            <div className="catalog-selected-display">
              <p>
                <strong>{withArFallback(form.nameEn, form.nameAr)}</strong>
              </p>
              <p className="hint">{withArFallback(form.manufacturerEn, form.manufacturerAr)}</p>
              {mode === 'create' && (
                <button type="button" className="btn-secondary" onClick={handleChangeSelection}>
                  {t('productForm.change')}
                </button>
              )}
            </div>
          )}
          <div className="form-row">
            <label>
              {t('productForm.unitEn')}
              <input
                value={form.unitEn}
                onChange={(e) => setField('unitEn', e.target.value)}
                placeholder="Box"
                required
              />
            </label>
            <label>
              {t('productForm.unitAr')}
              <input
                value={form.unitAr}
                onChange={(e) => setField('unitAr', e.target.value)}
                dir="rtl"
                placeholder="علبة"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              {t('common.category')}
              <select value={form.categoryId} onChange={(e) => setField('categoryId', e.target.value)} required>
                <option value="" disabled>
                  {t('productForm.selectCategory')}
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameEn}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t('productForm.priceUsd')}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.price}
              onChange={(e) => setField('price', e.target.value)}
              required
            />
          </label>
          {usdToSyp != null && Number(form.price) > 0 && (
            <p className="hint">
              {t('productForm.approxSyp', { amount: Math.round(Number(form.price) * usdToSyp).toLocaleString() })}
            </p>
          )}
          <label>
            {t('productForm.descriptionOptional')}
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            {t('productForm.imageUrlOptional')}
            <input value={form.image} onChange={(e) => setField('image', e.target.value)} placeholder="https://" />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.manuallyDisabled}
              onChange={(e) => setField('manuallyDisabled', e.target.checked)}
            />
            {t('productForm.temporarilyPaused')}
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('common.saving') : mode === 'create' ? t('products.addProduct') : t('productForm.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
