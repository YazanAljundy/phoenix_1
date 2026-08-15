import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import {
  ProductFormModal,
  productAvailabilityClass,
  productAvailabilityLabel,
  productFormFromProduct,
} from '../components/ProductFormModal';

// Section 13c: admin oversight across every warehouse's catalog - edit or
// deactivate only, never create (creating a product stays exclusively the
// warehouse's own job). Reuses the exact same form the warehouse itself
// edits with; only where the submission goes differs.
export function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouseFilter, setWarehouseFilter] = useState('');
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

  const visibleProducts = warehouseFilter
    ? products.filter((product) => product.warehouseId === warehouseFilter)
    : products;

  const categoryName = (categoryId) =>
    categories.find((category) => category.id === categoryId)?.nameEn ?? '-';

  const handleSaved = () => {
    setEditingProduct(null);
    load();
  };

  const handleDelete = async (product) => {
    const confirmed = window.confirm(
      `Remove "${product.nameEn}" (${product.warehouseNameEn})? Pharmacies will no longer be able to order it.`,
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
      <div className="section-toolbar section-toolbar-start">
        <label className="inline-filter">
          Warehouse
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">All warehouses</option>
            {warehouses.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : visibleProducts.length === 0 ? (
        <p className="hint">No products found.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Warehouse</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id} className={product.isActive ? '' : 'row-inactive'}>
                  <td>
                    <div className="product-name">{product.nameEn}</div>
                    <div className="product-manufacturer">{product.manufacturerEn}</div>
                  </td>
                  <td>{product.warehouseNameEn}</td>
                  <td>{categoryName(product.categoryId)}</td>
                  <td>{product.price} SYP</td>
                  <td>{product.stockQuantity}</td>
                  <td>
                    {product.isActive ? (
                      <span className={`availability-badge ${productAvailabilityClass(product)}`}>
                        {productAvailabilityLabel(product)}
                      </span>
                    ) : (
                      <span className="availability-badge availability-out">Removed</span>
                    )}
                  </td>
                  <td>
                    {product.isActive && (
                      <div className="table-row-actions">
                        <button className="btn-secondary" onClick={() => setEditingProduct(product)}>
                          Edit
                        </button>
                        <button
                          className="btn-reject"
                          disabled={busyId === product.id}
                          onClick={() => handleDelete(product)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingProduct && (
        <ProductFormModal
          mode="edit"
          initialForm={productFormFromProduct(editingProduct)}
          categories={categories}
          onClose={() => setEditingProduct(null)}
          onSaved={handleSaved}
          onSubmit={(payload) => api.updateAdminProduct(editingProduct.id, payload)}
        />
      )}
    </div>
  );
}
