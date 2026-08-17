import { useCallback, useEffect, useState } from 'react';
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

export function WarehouseProductsPage() {
  const usdToSyp = useExchangeRate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', product }

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

  return (
    <div>
      <div className="section-toolbar">
        <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
          Add product
        </button>
      </div>

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
                    <div className="product-name">{product.nameEn}</div>
                    <div className="product-manufacturer">{product.manufacturerEn}</div>
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
