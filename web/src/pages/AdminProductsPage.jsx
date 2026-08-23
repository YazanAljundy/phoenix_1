import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  ProductFormModal,
  productAvailabilityClass,
  productAvailabilityLabel,
  productFormFromProduct,
} from '../components/ProductFormModal';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatPriceWithSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 30;

// Section 13c: admin oversight across every warehouse's catalog - edit or
// deactivate only, never create (creating a product stays exclusively the
// warehouse's own job). Reuses the exact same form the warehouse itself
// edits with; only where the submission goes differs.
export function AdminProductsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    api.categories().then((data) => setCategories(data.categories));
    api.adminProductWarehouses().then((data) => setWarehouses(data.warehouses));
  }, []);

  // Debounced so typing doesn't fire a request per keystroke - the search
  // itself now runs server-side (a linked product's real name lives on its
  // catalog entry, not the product doc, see listPaginatedAllProducts).
  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .adminProducts({
          search: searchQuery || undefined,
          warehouseId: warehouseFilter || undefined,
          limit: PAGE_SIZE,
          after: cursor,
        })
        .then((data) => ({
          rows: data.products,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        })),
    [searchQuery, warehouseFilter]
  );

  const {
    data: products,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    reset,
  } = usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, warehouseFilter]);

  const handleSaved = () => {
    setEditingProduct(null);
    reset();
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
    setActionError(null);
    try {
      await api.deleteAdminProduct(product.id);
      reset();
    } catch (err) {
      setActionError(err.message);
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
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.nameEn}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="adm-filter-search"
          placeholder={t('products.searchByNamePlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : products.length === 0 ? (
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
                {products.map((product) => (
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
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
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
