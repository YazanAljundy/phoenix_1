import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  EMPTY_PRODUCT_FORM,
  ProductFormModal,
  productAvailabilityClass,
  productAvailabilityLabel,
  productFormFromProduct,
} from '../components/ProductFormModal';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatPriceWithSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';

export function WarehouseProductsPage() {
  const usdToSyp = useExchangeRate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', product }
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [productsData, categoriesData] = await Promise.all([
        api.warehouseProducts(),
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

  const categoryName = (categoryId) =>
    categories.find((category) => category.id === categoryId)?.nameEn ?? '-';

  const handleSaved = () => {
    setModal(null);
    load();
  };

  const handleDownloadTemplate = async () => {
    setError(null);
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
      setError(err.message);
    }
  };

  const handleFilePicked = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setError(null);
    setImportReport(null);
    try {
      const report = await api.importWarehouseProducts(file);
      setImportReport(report);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div>
      <div className="section-toolbar section-toolbar-start">
        <button className="btn-secondary" onClick={handleDownloadTemplate}>
          Download template
        </button>
        <button
          className="btn-secondary"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? 'Importing...' : 'Import Excel'}
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={handleFilePicked} />
        <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
          Add product
        </button>
      </div>

      {importReport && (
        <div className="exchange-rate-card">
          <p>
            Added {importReport.added}, updated {importReport.updated}
            {importReport.errors.length > 0 && `, ${importReport.errors.length} failed`}.
          </p>
          {importReport.errors.length > 0 && (
            <ul>
              {importReport.errors.map((e, index) => (
                <li key={index} className="error-text">
                  Row {e.row}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : products.length === 0 ? (
        <p className="hint">No products yet - add your first one.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
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
                  <td>{formatPriceWithSyp(product.priceUsd, usdToSyp)}</td>
                  <td>
                    <span className={`availability-badge ${productAvailabilityClass(product)}`}>
                      {productAvailabilityLabel(product)}
                    </span>
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => setModal({ mode: 'edit', product })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
