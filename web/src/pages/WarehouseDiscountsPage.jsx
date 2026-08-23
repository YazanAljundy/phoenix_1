import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

// Section 15: a warehouse-set, always-on discount per manufacturer, stacked
// automatically onto every one of that manufacturer's products in the
// pharmacist-facing catalog and at order time - see
// backend/src/services/manufacturerDiscount.service.js. The manufacturer
// dropdown lists this warehouse's manufacturer registry (populated by Excel
// imports, sticky even if a manufacturer's products are later removed - see
// backend/src/services/warehouseManufacturer.service.js), never free text.
export function WarehouseDiscountsPage() {
  const { t } = useTranslation();
  const [discounts, setDiscounts] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [percentage, setPercentage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editPercentage, setEditPercentage] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [discountsData, manufacturersData] = await Promise.all([
        api.warehouseDiscounts(),
        api.warehouseManufacturers(),
      ]);
      // Newest first - the backend sorts these alphabetically by
      // manufacturer, so sort by createdAt here rather than a plain reverse,
      // which would just flip alphabetical order.
      setDiscounts(
        discountsData.discounts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      );
      setManufacturers(manufacturersData.manufacturers);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Already-discounted manufacturers don't show up again in the "add" list
  // - the unique (warehouse, manufacturer) rule means a second entry would
  // just fail; editing the existing row is the way to change it.
  const discountedNames = new Set(discounts.map((d) => d.manufacturerAr));
  const availableManufacturers = manufacturers.filter((name) => !discountedNames.has(name));

  const handleAdd = async (event) => {
    event.preventDefault();
    setError(null);

    const pct = Number(percentage);
    if (!selectedManufacturer) {
      setError(t('discounts.pleaseSelectManufacturer'));
      return;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setError(t('discounts.percentRange'));
      return;
    }

    setIsSaving(true);
    try {
      await api.createWarehouseDiscount({ manufacturerAr: selectedManufacturer, discountPercentage: pct });
      setSelectedManufacturer('');
      setPercentage('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (discount) => {
    setEditingId(discount.id);
    setEditPercentage(String(discount.discountPercentage));
  };

  const handleSaveEdit = async (id) => {
    setError(null);
    const pct = Number(editPercentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setError(t('discounts.percentRange'));
      return;
    }
    setBusyId(id);
    try {
      await api.updateWarehouseDiscount(id, { discountPercentage: pct });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (discount) => {
    const confirmed = window.confirm(t('discounts.confirmRemove', { name: discount.manufacturerAr }));
    if (!confirmed) return;

    setBusyId(discount.id);
    setError(null);
    try {
      await api.deleteWarehouseDiscount(discount.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.discounts')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="wh-detail-grid">
        <div style={{ minWidth: 0 }}>
          {isLoading ? (
            <p className="hint">{t('common.loading')}</p>
          ) : discounts.length === 0 ? (
            <div className="wh-empty-state">
              <div className="wh-empty-state-icon">%</div>
              <div className="wh-empty-state-title">{t('discounts.emptyTitle')}</div>
              <div className="wh-empty-state-body">{t('discounts.emptyBody')}</div>
            </div>
          ) : (
            <div className="wh-card table-scroll">
              <table className="wh-table">
                <thead>
                  <tr>
                    <th>{t('discounts.manufacturer')}</th>
                    <th>{t('discounts.discountColumn')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map((discount) => (
                    <tr key={discount.id}>
                      <td>{discount.manufacturerAr}</td>
                      <td className="wh-num">
                        {editingId === discount.id ? (
                          <input
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            value={editPercentage}
                            onChange={(e) => setEditPercentage(e.target.value)}
                            style={{ width: 80 }}
                          />
                        ) : (
                          `${discount.discountPercentage}%`
                        )}
                      </td>
                      <td>
                        <div className="table-row-actions">
                          {editingId === discount.id ? (
                            <>
                              <button
                                className="btn-secondary"
                                disabled={busyId === discount.id}
                                onClick={() => handleSaveEdit(discount.id)}
                              >
                                {t('common.save')}
                              </button>
                              <button className="btn-secondary" onClick={() => setEditingId(null)}>
                                {t('common.cancel')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="btn-secondary" onClick={() => startEdit(discount)}>
                                {t('common.edit')}
                              </button>
                              <button
                                className="btn-reject"
                                disabled={busyId === discount.id}
                                onClick={() => handleDelete(discount)}
                              >
                                {t('common.delete')}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="wh-detail-card">
          <h2 className="wh-detail-card-title">{t('discounts.addTitle')}</h2>
          <form onSubmit={handleAdd} className="product-form">
            <label>
              {t('discounts.manufacturer')}
              <select
                value={selectedManufacturer}
                onChange={(e) => setSelectedManufacturer(e.target.value)}
                required
              >
                <option value="" disabled>
                  {availableManufacturers.length === 0
                    ? t('discounts.noManufacturersAvailable')
                    : t('discounts.selectManufacturer')}
                </option>
                {availableManufacturers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('discounts.discountPercent')}
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={isSaving || availableManufacturers.length === 0}
            >
              {isSaving ? t('discounts.adding') : t('discounts.addDiscount')}
            </button>
          </form>
          <p className="hint" style={{ marginTop: 14, fontSize: 12 }}>
            {t('discounts.availableManufacturersHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
