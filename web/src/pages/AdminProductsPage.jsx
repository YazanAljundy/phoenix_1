import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  ProductFormModal,
  productAvailabilityClass,
  productAvailabilityLabel,
  productFormFromProduct,
} from '../components/ProductFormModal';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatPriceWithSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

// Section 13c: admin oversight across every warehouse's catalog - edit or
// deactivate only, never create (creating a product stays exclusively the
// warehouse's own job). Reuses the exact same form the warehouse itself
// edits with; only where the submission goes differs.
export function AdminProductsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [productsData, categoriesData] = await Promise.all([
        api.adminProducts(),
        api.categories(),
      ]);
      setProducts(productsData.products);
      setCategories(categoriesData.categories);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const warehouses = useMemo(() => {
    const seen = new Map();
    for (const product of products) {
      if (!seen.has(product.warehouseId)) {
        seen.set(product.warehouseId, product.warehouseNameEn);
      }
    }
    return [...seen.entries()];
  }, [products]);

  // Client-side only, over the already-fetched full list - no new request,
  // same as the warehouse filter above.
  const query = searchQuery.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    if (warehouseFilter && product.warehouseId !== warehouseFilter) return false;
    if (!query) return true;
    const haystack = [product.nameEn, product.nameAr, product.manufacturerEn, product.manufacturerAr]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });

  const handleSaved = () => {
    setEditingProduct(null);
    load();
  };

  const handleDelete = async (product) => {
    const confirmed = window.confirm(
      t('products.confirmRemove', {
        name: withArFallback(product.nameEn, product.nameAr),
        warehouse: product.warehouseNameEn,
      }),
    );
    if (!confirmed) return;

    setBusyId(product.id);
    setError(null);
    try {
      await api.deleteAdminProduct(product.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.products')}</h1>
      </div>

      <div className="adm-filters-row">
        <select
          className="adm-filter-select"
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
        >
          <option value="">{t('products.allWarehouses')}</option>
          {warehouses.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="adm-filter-search"
          placeholder={t('products.searchByNamePlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : visibleProducts.length === 0 ? (
        <div className="adm-empty-state">
          <div className="adm-empty-state-icon">&#128138;</div>
          <div className="adm-empty-state-title">{t('products.noProductsAdmin')}</div>
        </div>
      ) : (
        <>
          <div className="adm-card table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.warehouse')}</th>
                  <th>{t('common.manufacturer')}</th>
                  <th>{t('common.price')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('admin.pendingAccounts.actionColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product) => (
                  <tr key={product.id} className={product.isActive ? '' : 'row-inactive'}>
                    <td>{withArFallback(product.nameEn, product.nameAr)}</td>
                    <td>{product.warehouseNameEn}</td>
                    <td>{withArFallback(product.manufacturerEn, product.manufacturerAr)}</td>
                    <td className="adm-num">{formatPriceWithSyp(product.priceUsd, usdToSyp)}</td>
                    <td>
                      {product.isActive ? (
                        <span className={`availability-badge ${productAvailabilityClass(product)}`}>
                          {productAvailabilityLabel(product, t)}
                        </span>
                      ) : (
                        <span className="availability-badge availability-out">{t('products.removed')}</span>
                      )}
                    </td>
                    <td>
                      {product.isActive && (
                        <div className="adm-row-actions">
                          <button className="adm-row-action" onClick={() => setEditingProduct(product)}>
                            {t('common.edit')}
                          </button>
                          <button
                            className="adm-row-action adm-row-action-danger"
                            disabled={busyId === product.id}
                            onClick={() => handleDelete(product)}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-table-hint">{t('products.adminEditHint')}</p>
        </>
      )}

      {editingProduct && (
        <ProductFormModal
          mode="edit"
          initialForm={productFormFromProduct(editingProduct)}
          categories={categories}
          usdToSyp={usdToSyp}
          onClose={() => setEditingProduct(null)}
          onSaved={handleSaved}
          onSubmit={(payload) => api.updateAdminProduct(editingProduct.id, payload)}
        />
      )}
    </div>
  );
}
