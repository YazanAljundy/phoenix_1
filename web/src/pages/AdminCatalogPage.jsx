import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

// Section 14 Part 1: the admin-curated master medicine list. Excel-import
// only - there's deliberately no "add medicine" button/form here, matching
// the backend (no POST /admin/catalog, see adminCatalog.routes.js).
export function AdminCatalogPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async (q) => {
    setIsLoading(true);
    setError(null);
    try {
      const [catalogData, categoriesData] = await Promise.all([
        api.adminCatalog(q),
        api.categories(),
      ]);
      setItems(catalogData.items);
      setCategories(categoriesData.categories);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    load(search);
  };

  const categoryName = (categoryId) =>
    categories.find((category) => category.id === categoryId)?.nameEn ?? '-';

  const handleDownloadTemplate = async () => {
    setError(null);
    try {
      const blob = await api.downloadCatalogTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'product-catalog-template.xlsx';
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
      const report = await api.importCatalogExcel(file);
      setImportReport(report);
      await load(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleToggleActive = async (item) => {
    setBusyId(item.id);
    setError(null);
    try {
      if (item.isActive) {
        await api.deactivateCatalogItem(item.id);
      } else {
        await api.updateCatalogItem(item.id, { isActive: true });
      }
      await load(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="section-toolbar section-toolbar-start">
        <button className="btn-secondary" onClick={handleDownloadTemplate}>
          Download template
        </button>
        <button
          className="btn-primary"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? 'Importing...' : 'Import Excel'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={handleFilePicked}
        />
        <form className="inline-filter" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
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
      ) : items.length === 0 ? (
        <p className="hint">No catalog entries yet - import an Excel file to get started.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Manufacturer</th>
                <th>Category</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.isActive ? '' : 'row-inactive'}>
                  <td>{item.nameAr}</td>
                  <td>{item.manufacturerAr}</td>
                  <td>{categoryName(item.categoryId)}</td>
                  <td>
                    <span
                      className={`availability-badge ${item.isActive ? 'availability-available' : 'availability-paused'}`}
                    >
                      {item.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-secondary"
                      disabled={busyId === item.id}
                      onClick={() => handleToggleActive(item)}
                    >
                      {item.isActive ? 'Disable' : 'Enable'}
                    </button>
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
