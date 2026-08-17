import { useState } from 'react';

export const EMPTY_PRODUCT_FORM = {
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
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    categoryId: product.categoryId,
    unitAr: product.unitAr,
    unitEn: product.unitEn,
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const requiredFields = [
      'nameAr', 'nameEn', 'manufacturerAr', 'manufacturerEn', 'unitAr', 'unitEn', 'categoryId',
    ];
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
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim(),
      manufacturerAr: form.manufacturerAr.trim(),
      manufacturerEn: form.manufacturerEn.trim(),
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
          <div className="form-row">
            <label>
              Name (English)
              <input value={form.nameEn} onChange={(e) => setField('nameEn', e.target.value)} required />
            </label>
            <label>
              Name (Arabic)
              <input
                value={form.nameAr}
                onChange={(e) => setField('nameAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Manufacturer (English)
              <input
                value={form.manufacturerEn}
                onChange={(e) => setField('manufacturerEn', e.target.value)}
                required
              />
            </label>
            <label>
              Manufacturer (Arabic)
              <input
                value={form.manufacturerAr}
                onChange={(e) => setField('manufacturerAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
          </div>
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
