import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const EMPTY_FORM = {
  productId: '',
  titleAr: '',
  titleEn: '',
  discountPercentage: '',
  startDate: '',
  endDate: '',
};

function statusLabel(offer) {
  return offer.status === 'approved' ? 'Approved' : 'Pending review';
}

function CreateOfferModal({ products, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!form.productId || !form.titleAr.trim() || !form.titleEn.trim() || !form.startDate || !form.endDate) {
      setError('Please fill in all required fields.');
      return;
    }
    const discountPercentage = Number(form.discountPercentage);
    if (!Number.isFinite(discountPercentage) || discountPercentage <= 0 || discountPercentage > 100) {
      setError('Discount must be a number between 1 and 100.');
      return;
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      setError('End date must be after the start date.');
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
        <h2>New offer</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            Product
            <select value={form.productId} onChange={(e) => setField('productId', e.target.value)} required>
              <option value="" disabled>
                Select a product
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.nameEn} ({product.price} SYP)
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Title (English)
              <input value={form.titleEn} onChange={(e) => setField('titleEn', e.target.value)} required />
            </label>
            <label>
              Title (Arabic)
              <input
                value={form.titleAr}
                onChange={(e) => setField('titleAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
          </div>
          <label>
            Discount percentage
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
              Start date
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
                required
              />
            </label>
            <label>
              End date
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
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Submitting...' : 'Submit for approval'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WarehouseOffersPage() {
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [offersData, productsData] = await Promise.all([
        api.warehouseOffers(),
        api.warehouseProducts(),
      ]);
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
      <div className="section-toolbar">
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          New offer
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : offers.length === 0 ? (
        <p className="hint">No offers yet - propose your first discount.</p>
      ) : (
        <div className="order-list">
          {offers.map((offer) => (
            <div className="order-card" key={offer.id}>
              <div className="order-card-header">
                <div>
                  <h2>{offer.productNameEn}</h2>
                  <p>{offer.titleEn}</p>
                </div>
                <span
                  className={`status-badge ${offer.status === 'approved' ? 'status-delivered' : 'status-pending'}`}
                >
                  {statusLabel(offer)}
                </span>
              </div>
              <p className="order-items">{offer.discountPercentage}% off</p>
              <p className="order-notes">
                {new Date(offer.startDate).toLocaleDateString()} &ndash;{' '}
                {new Date(offer.endDate).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateOfferModal products={products} onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
