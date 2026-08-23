import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';

const PAGE_SIZE = 30;

// Section: edits exactly the 4 fields updateCatalogItem actually accepts
// (nameAr/unitAr/categoryId/isActive) - see productCatalog.service.js. The
// isActive toggle stays its own row button (mirrors the mockup's separate
// "toggle" action), so it's left out of this form.
function EditCatalogItemModal({ item, categories, onClose, onSaved }) {
  const { t } = useTranslation();
  const [nameAr, setNameAr] = useState(item.nameAr);
  const [unitAr, setUnitAr] = useState(item.unitAr ?? '');
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!nameAr.trim()) {
      setError(t('common.requiredFields'));
      return;
    }

    setIsSaving(true);
    try {
      await api.updateCatalogItem(item.id, {
        nameAr: nameAr.trim(),
        unitAr: unitAr.trim() || null,
        categoryId: categoryId || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('admin.catalog.editTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <p className="hint">{item.manufacturerAr}</p>
          <label>
            {t('admin.catalog.nameArLabel')}
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" required />
          </label>
          <label>
            {t('productForm.unitAr')}
            <input value={unitAr} onChange={(e) => setUnitAr(e.target.value)} dir="rtl" />
          </label>
          <label>
            {t('common.category')}
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('admin.catalog.noCategoryOption')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nameEn}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Section: the import-result dialog (mockup frame 1g) - a distinct
// sharp-cornered overlay rather than the generic rounded `.modal`, since the
// mockup calls it out as its own component with its own stat cards.
function ImportResultModal({ report, fileName, onClose }) {
  const { t } = useTranslation();
  const totalRows = report.added + report.updated + report.errors.length;

  const handleDownloadErrors = () => {
    const lines = ['row,reason', ...report.errors.map((e) => `${e.row},"${e.reason.replace(/"/g, '""')}"`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'catalog-import-errors.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="adm-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="adm-import-title">{t('admin.catalog.importResultTitle')}</div>
        <div className="adm-import-file">
          {t('admin.catalog.importSummary', { fileName, count: totalRows })}
        </div>
        <div className="adm-import-stats">
          <div className="adm-import-stat adm-import-stat-added">
            <div className="adm-import-stat-value">{report.added}</div>
            <div className="adm-import-stat-label">{t('admin.catalog.importResultAdded')}</div>
          </div>
          <div className="adm-import-stat adm-import-stat-updated">
            <div className="adm-import-stat-value">{report.updated}</div>
            <div className="adm-import-stat-label">{t('admin.catalog.importResultUpdated')}</div>
          </div>
          <div className="adm-import-stat adm-import-stat-failed">
            <div className="adm-import-stat-value">{report.errors.length}</div>
            <div className="adm-import-stat-label">{t('admin.catalog.importResultFailed')}</div>
          </div>
        </div>
        {report.errors.length > 0 && (
          <div className="adm-import-errors">
            <div className="adm-import-errors-head">{t('admin.catalog.importErrorsTitle')}</div>
            {report.errors.map((e, index) => (
              <div key={index} className="adm-import-error-row">
                <span className="adm-import-error-row-num">{e.row}</span>
                {e.reason}
              </div>
            ))}
          </div>
        )}
        <div className="adm-import-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            {t('admin.catalog.importDone')}
          </button>
          {report.errors.length > 0 && (
            <button type="button" className="btn-secondary" onClick={handleDownloadErrors}>
              {t('admin.catalog.downloadErrorReport')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Section 14 Part 1: the admin-curated master medicine list. Excel-import
// only - there's deliberately no "add medicine" button/form here, matching
// the backend (no POST /admin/catalog, see adminCatalog.routes.js).
export function AdminCatalogPage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.categories().then((data) => setCategories(data.categories));
  }, []);

  const fetchPage = useCallback(
    (cursor) =>
      api.adminCatalog({ search, limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.items,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    [search]
  );

  const { data: items, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    reset();
  };

  const handleDownloadTemplate = async () => {
    setActionError(null);
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
      const report = await api.importCatalogExcel(file);
      setImportReport(report);
      setImportFileName(file.name);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleToggleActive = async (item) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      if (item.isActive) {
        await api.deactivateCatalogItem(item.id);
      } else {
        await api.updateCatalogItem(item.id, { isActive: true });
      }
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleEditSaved = () => {
    setEditingItem(null);
    reset();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.centralCatalog')}</h1>
        <div className="adm-page-head-actions">
          <button className="btn-secondary" onClick={handleDownloadTemplate}>
            {t('products.downloadTemplate')}
          </button>
          <button
            className="btn-primary"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            {isImporting ? t('products.importing') : t('products.importExcel')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={handleFilePicked}
          />
        </div>
      </div>

      <form className="adm-filters-row" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          className="adm-filter-search"
          placeholder={t('admin.catalog.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          {t('common.search')}
        </button>
      </form>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <div className="adm-empty-state">
          <div className="adm-empty-state-icon">&#128138;</div>
          <div className="adm-empty-state-title">{t('admin.catalog.noEntries')}</div>
        </div>
      ) : (
        <>
          <div className="adm-card table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.manufacturer')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('admin.pendingAccounts.actionColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.isActive ? '' : 'row-inactive'}>
                    <td>{item.nameAr}</td>
                    <td>{item.manufacturerAr}</td>
                    <td>
                      <span
                        className={`availability-badge ${item.isActive ? 'availability-available' : 'availability-paused'}`}
                      >
                        {item.isActive ? t('admin.catalog.active') : t('admin.catalog.disabled')}
                      </span>
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        <button className="adm-row-action" onClick={() => setEditingItem(item)}>
                          {t('common.edit')}
                        </button>
                        <button
                          className={`adm-row-action ${item.isActive ? 'adm-row-action-danger' : ''}`}
                          disabled={busyId === item.id}
                          onClick={() => handleToggleActive(item)}
                        >
                          {item.isActive ? t('admin.catalog.disable') : t('admin.catalog.enable')}
                        </button>
                      </div>
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

      {editingItem && (
        <EditCatalogItemModal
          item={editingItem}
          categories={categories}
          onClose={() => setEditingItem(null)}
          onSaved={handleEditSaved}
        />
      )}

      {importReport && (
        <ImportResultModal
          report={importReport}
          fileName={importFileName}
          onClose={() => setImportReport(null)}
        />
      )}
    </div>
  );
}
