import { useEffect, useState } from 'react';
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
export function productAvailabilityLabel(product) {
  return product.manuallyDisabled ? 'Paused' : 'Available';
}

export function productAvailabilityClass(product) {
  return product.isAvailable ? 'availability-available' : 'availability-paused';
}

// Section 14 Part 2: a medicine's name/manufacturer are only ever chosen by
// searching the central catalog, never typed - this is the search+select UI
// for that, used only when creating a product (an existing one's link isn't
// re-editable, see ProductFormModal below).
function CatalogSearchField({ onSelect }) {
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
      Medicine (search the central catalog)
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Start typing a medicine name..."
        dir="rtl"
      />
      {isSearching && <p className="hint">Searching...</p>}
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
        <p className="hint">No matching medicine in the central catalog.</p>
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
      setError('Please select a medicine from the central catalog.');
      return;
    }

    const requiredFields = ['unitAr', 'unitEn', 'categoryId'];
    if (requiredFields.some((field) => !form[field].trim())) {
      setError('Please fill in all required fields.');
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Price must be a positive number.');
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
        <h2>{mode === 'create' ? 'Add product' : 'Edit product'}</h2>
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
                  Change
                </button>
              )}
            </div>
          )}
          <div className="form-row">
            <label>
              Unit (English)
              <input
                value={form.unitEn}
                onChange={(e) => setField('unitEn', e.target.value)}
                placeholder="Box"
                required
              />
            </label>
            <label>
              Unit (Arabic)
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
              Category
              <select value={form.categoryId} onChange={(e) => setField('categoryId', e.target.value)} required>
                <option value="" disabled>
                  Select a category
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
            Price (USD)
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
            <p className="hint">≈ {Math.round(Number(form.price) * usdToSyp).toLocaleString()} SYP</p>
          )}
          <label>
            Description (optional)
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Image URL (optional)
            <input value={form.image} onChange={(e) => setField('image', e.target.value)} placeholder="https://" />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.manuallyDisabled}
              onChange={(e) => setField('manuallyDisabled', e.target.checked)}
            />
            Temporarily paused (hidden from pharmacies)
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : mode === 'create' ? 'Add product' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
