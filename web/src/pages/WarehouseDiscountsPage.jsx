import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

// Section 15: a warehouse-set, always-on discount per manufacturer, stacked
// automatically onto every one of that manufacturer's products in the
// pharmacist-facing catalog and at order time - see
// backend/src/services/manufacturerDiscount.service.js. The manufacturer
// dropdown lists this warehouse's manufacturer registry (populated by Excel
// imports, sticky even if a manufacturer's products are later removed - see
// backend/src/services/warehouseManufacturer.service.js), never free text.
export function WarehouseDiscountsPage() {
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
      setDiscounts(discountsData.discounts);
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
      setError('Please select a manufacturer.');
      return;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setError('Discount percentage must be between 1 and 100.');
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
      setError('Discount percentage must be between 1 and 100.');
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
    const confirmed = window.confirm(`Remove the discount for "${discount.manufacturerAr}"?`);
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
      <div className="exchange-rate-card">
        <h2>Add a manufacturer discount</h2>
        <form onSubmit={handleAdd} className="form-row">
          <label>
            Manufacturer
            <select
              value={selectedManufacturer}
              onChange={(e) => setSelectedManufacturer(e.target.value)}
              required
            >
              <option value="" disabled>
                {availableManufacturers.length === 0 ? 'No manufacturers available' : 'Select a manufacturer'}
              </option>
              {availableManufacturers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Discount %
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
          <button type="submit" className="btn-primary" disabled={isSaving || availableManufacturers.length === 0}>
            {isSaving ? 'Adding...' : 'Add discount'}
          </button>
        </form>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : discounts.length === 0 ? (
        <p className="hint">No manufacturer discounts yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Manufacturer</th>
                <th>Discount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((discount) => (
                <tr key={discount.id}>
                  <td>{discount.manufacturerAr}</td>
                  <td>
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
                            Save
                          </button>
                          <button className="btn-secondary" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-secondary" onClick={() => startEdit(discount)}>
                            Edit
                          </button>
                          <button
                            className="btn-reject"
                            disabled={busyId === discount.id}
                            onClick={() => handleDelete(discount)}
                          >
                            Delete
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
  );
}
