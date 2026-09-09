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
import { formatUsdAsSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

// The catalog opens on the warehouse's companies, not on its products: one
// flat newest-first list of every medicine a warehouse carries is not
// something anyone can navigate, and the company is how a warehouse already
// thinks about its stock (it imports a price list per company, and discounts
// are set per company). Picking one drills into that company's products - the
// same table as before, only scoped - with the toolbar left untouched on both
// levels so importing and adding never move.
export function WarehouseProductsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', product }
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [actionError, setActionError] = useState(null);
  const fileInputRef = useRef(null);

  // null = the company list; otherwise the company whose products are open.
  const [selectedManufacturer, setSelectedManufacturer] = useState(null);
  const [manufacturers, setManufacturers] = useState([]);
  const [isLoadingManufacturers, setIsLoadingManufacturers] = useState(true);
  const [manufacturersError, setManufacturersError] = useState(null);

  // The Arabic name is the identity everything else keys on (the product
  // filter, discounts, the import registry); the English one is only ever a
  // label. Kept as a primitive so the reset effect below has a stable
  // dependency - the objects it comes from are replaced on every refetch.
  const selectedManufacturerAr = selectedManufacturer?.manufacturerAr ?? null;

  useEffect(() => {
    api.categories().then((data) => setCategories(data.categories));
  }, []);

  const loadManufacturers = useCallback(async () => {
    setIsLoadingManufacturers(true);
    setManufacturersError(null);
    try {
      const data = await api.warehouseManufacturers({ inCatalog: true });
      setManufacturers(data.manufacturers);
    } catch (err) {
      setManufacturersError(err.message);
    } finally {
      setIsLoadingManufacturers(false);
    }
  }, []);

  useEffect(() => {
    loadManufacturers();
  }, [loadManufacturers]);

  // Newest first is the backend's own paginated sort now (see
  // listPaginatedProductsForWarehouse) - no client-side re-sort needed here.
  // The company filter is sent to the server rather than applied here, so
  // "Load more" keeps paging within the open company.
  const fetchPage = useCallback(
    (cursor) =>
      api
        .warehouseProducts({
          limit: PAGE_SIZE,
          after: cursor,
          manufacturer: selectedManufacturerAr ?? undefined,
        })
        .then((data) => ({
          rows: data.products,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        })),
    [selectedManufacturerAr]
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

  // The one `reset` on a filter dependency that usePaginatedData expects.
  // Guarded on a company being open: the company list needs no products, so
  // landing on the page no longer costs a product request at all.
  useEffect(() => {
    if (selectedManufacturerAr !== null) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManufacturerAr]);

  const categoryName = (categoryId) =>
    categories.find((category) => category.id === categoryId)?.nameEn ?? '-';

  // Both the open list and the company list are refreshed: a newly added
  // product can bring a company into the catalog that was not there before,
  // and every save changes some company's product count.
  const handleSaved = () => {
    setModal(null);
    if (selectedManufacturerAr !== null) reset();
    loadManufacturers();
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
      if (selectedManufacturerAr !== null) reset();
      loadManufacturers();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const manufacturerLabel = (manufacturer) =>
    withArFallback(manufacturer.manufacturerEn, manufacturer.manufacturerAr);

  // Whichever list is on screen owns the error line; `actionError` (template
  // download, import) belongs to the toolbar and shows on both levels.
  const listError = selectedManufacturer ? error : manufacturersError;

  // usePaginatedData keeps the rows it last accumulated, so for the one render
  // between opening a second company and the reset effect firing, the previous
  // company's products are still in hand - they would otherwise flash under the
  // new company's title. An empty array passes, so a company with nothing in it
  // still reaches the empty state instead of spinning forever.
  const productsBelongToOpenCompany =
    selectedManufacturerAr !== null &&
    products.every((product) => product.manufacturerAr === selectedManufacturerAr);

  return (
    <div>
      {selectedManufacturer && (
        <button className="wh-detail-back" onClick={() => setSelectedManufacturer(null)}>
          &larr; {t('products.backToCompanies')}
        </button>
      )}

      <div className="wh-page-head">
        <h1>{selectedManufacturer ? manufacturerLabel(selectedManufacturer) : t('nav.catalog')}</h1>
        {selectedManufacturer && <span className="wh-page-head-meta">{t('nav.catalog')}</span>}
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

      {(listError || actionError) && <p className="error-text">{listError || actionError}</p>}

      {!selectedManufacturer ? (
        <CompanyList
          manufacturers={manufacturers}
          isLoading={isLoadingManufacturers}
          onSelect={setSelectedManufacturer}
        />
      ) : isLoading || !productsBelongToOpenCompany ? (
        <p className="hint">{t('common.loading')}</p>
      ) : products.length === 0 ? (
        // Only reachable if the company's last product went away between the
        // company list loading and the card being opened - a company card is
        // built from products that exist.
        <p className="hint">{t('products.noProductsForCompany')}</p>
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
                    <td className="wh-num">{formatUsdAsSyp(product.priceUsd, usdToSyp)}</td>
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
          initialForm={modal.mode === 'create' ? EMPTY_PRODUCT_FORM : productFormFromProduct(modal.product, usdToSyp)}
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

// The catalog's first level: one card per company in this warehouse's catalog.
//
// Not paginated, and deliberately so - this is a list of companies, not of
// products, and the backend returns it as a single grouped read (a warehouse
// carries tens of companies, not thousands). "Load more" stays where it was,
// on the products inside a company.
function CompanyList({ manufacturers, isLoading, onSelect }) {
  const { t } = useTranslation();

  if (isLoading) return <p className="hint">{t('common.loading')}</p>;
  // No companies means no products at all, which is what this line already
  // says on an empty catalog.
  if (manufacturers.length === 0) return <p className="hint">{t('products.noProductsWarehouse')}</p>;

  return (
    <div className="wh-company-grid">
      {manufacturers.map((manufacturer) => (
        <button
          key={manufacturer.manufacturerAr}
          type="button"
          className="wh-company-card"
          onClick={() => onSelect(manufacturer)}
        >
          <span className="wh-company-card-name">
            {withArFallback(manufacturer.manufacturerEn, manufacturer.manufacturerAr)}
          </span>
          <span className="wh-company-card-count">
            {t('products.companyProductCount', { count: manufacturer.productCount })}
          </span>
        </button>
      ))}
    </div>
  );
}
