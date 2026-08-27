import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  EMPTY_PRODUCT_FORM,
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

const PAGE_SIZE = 20;

export function WarehouseProductsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', product }
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [actionError, setActionError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.categories().then((data) => setCategories(data.categories));
  }, []);

  // Newest first is the backend's own paginated sort now (see
  // listPaginatedProductsForWarehouse) - no client-side re-sort needed here.
  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseProducts({ limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.products,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    []
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
  }, []);

  const categoryName = (categoryId) =>
    categories.find((category) => category.id === categoryId)?.nameEn ?? '-';

  const handleSaved = () => {
    setModal(null);
    reset();
  };

  const handleDownloadTemplate = async () => {
    setActionError(null);
    try {
      const blob = await api.downloadWarehouseProductTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'my-products-template.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleFilePicked = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setActionError(null);
    setImportReport(null);
    try {
      const report = await api.importWarehouseProducts(file);
      setImportReport(report);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.catalog')}</h1>
      </div>

      <div className="section-toolbar section-toolbar-start">
        <button className="btn-secondary" onClick={handleDownloadTemplate}>
          {t('products.downloadTemplate')}
        </button>
        <button
          className="btn-secondary"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? t('products.importing') : t('products.importExcel')}
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={handleFilePicked} />
        <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
          {t('products.addProduct')}
        </button>
      </div>

      {importReport && (
        <div className="exchange-rate-card">
          <p>
            {t('products.importReport', {
              added: importReport.added,
              updated: importReport.updated,
              failed:
                importReport.errors.length > 0
                  ? t('products.importReportFailed', { count: importReport.errors.length })
                  : '',
            })}
          </p>
          {importReport.convertedFromSyp > 0 && (
            <p className="import-conversion-note">
              {t('products.importConverted', { count: importReport.convertedFromSyp })}
              {importReport.exchangeRateUsed != null && (
                <>
                  <br />
                  {t('products.importConvertedRate', { rate: importReport.exchangeRateUsed })}
                </>
              )}
            </p>
          )}
          {importReport.errors.length > 0 && (
            <ul>
              {importReport.errors.map((e, index) => (
                <li key={index} className="error-text">
                  {t('products.importRowError', { row: e.row, reason: e.reason })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : products.length === 0 ? (
        <p className="hint">{t('products.noProductsWarehouse')}</p>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.category')}</th>
                  <th>{t('common.price')}</th>
                  <th>{t('common.status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className="product-name">{withArFallback(product.nameEn, product.nameAr)}</div>
                      <div className="product-manufacturer">
                        {withArFallback(product.manufacturerEn, product.manufacturerAr)}
                      </div>
                    </td>
                    <td>{categoryName(product.categoryId)}</td>
                    <td className="wh-num">{formatPriceWithSyp(product.priceUsd, usdToSyp)}</td>
                    <td>
                      <span className={`availability-badge ${productAvailabilityClass(product)}`}>
                        {productAvailabilityLabel(product, t)}
                      </span>
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => setModal({ mode: 'edit', product })}>
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
        </>
      )}

      {modal && (
        <ProductFormModal
          mode={modal.mode}
          initialForm={modal.mode === 'create' ? EMPTY_PRODUCT_FORM : productFormFromProduct(modal.product)}
          categories={categories}
          usdToSyp={usdToSyp}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onSubmit={(payload) =>
            modal.mode === 'create'
              ? api.createWarehouseProduct(payload)
              : api.updateWarehouseProduct(modal.product.id, payload)
          }
        />
      )}
    </div>
  );
}
