import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

// Section: always-visible composer (mockup frame 1e) rather than a
// "Publish new banner" button opening a modal - same state/validation/
// submit-to-createAdminBanner logic as the old CreateBannerModal, just
// without the modal wrapper/cancel button, matching the warehouse Discounts
// page's earlier modal->inline conversion.
function BannerComposer({ products, onCreated }) {
  const { t } = useTranslation();
  const [imageFile, setImageFile] = useState(null);
  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!imageFile || !title.trim() || !startDate || !endDate) {
      setError(t('common.requiredFields'));
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError(t('common.endAfterStart'));
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('title', title.trim());
      formData.append('startDate', startDate);
      formData.append('endDate', endDate);
      if (productId) formData.append('productId', productId);
      await api.createAdminBanner(formData);
      setImageFile(null);
      setTitle('');
      setProductId('');
      setStartDate('');
      setEndDate('');
      event.target.reset();
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="adm-detail-card">
      <h2 className="adm-detail-card-title">{t('banners.admin.modalTitle')}</h2>
      <p className="adm-detail-card-hint">{t('banners.admin.composerHint')}</p>
      <form onSubmit={handleSubmit} className="product-form">
        <label>
          {t('banners.image')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>
        <label>
          {t('banners.title')}
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          {t('banners.linkedProductOptional')}
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t('banners.noProduct')}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {withArFallback(product.nameEn, product.nameAr)} &middot; {product.warehouseNameEn}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            {t('common.startDate')}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <label>
            {t('common.endDate')}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={isSaving}>
          {isSaving ? t('banners.publishing') : t('banners.admin.publishBanner')}
        </button>
      </form>
    </div>
  );
}

function bannerStatusBadgeClass(banner) {
  if (banner.status === 'approved') return 'status-delivered';
  if (banner.status === 'rejected') return 'status-cancelled';
  return 'status-pending';
}

function useBannerStatusLabel() {
  const { t } = useTranslation();
  return (banner) => {
    if (banner.status === 'approved') return t('banners.statusApproved');
    if (banner.status === 'rejected') return t('banners.statusRejected');
    return t('banners.statusPending');
  };
}

function EditBannerModal({ banner, onClose, onSaved }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(banner.title);
  const [startDate, setStartDate] = useState(banner.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(banner.endDate.slice(0, 10));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !startDate || !endDate) {
      setError(t('common.fillAllFields'));
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError(t('common.endAfterStart'));
      return;
    }

    setIsSaving(true);
    try {
      await api.updateAdminBanner(banner.id, { title: title.trim(), startDate, endDate });
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
        <h2>{t('banners.admin.editBanner')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('banners.title')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              {t('common.startDate')}
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label>
              {t('common.endDate')}
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </label>
          </div>

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

// Section: every banner regardless of status - approve/reject apply to the
// pending ones, edit (dates/title) applies to pending or approved, and
// delete works across all three statuses (admin has full authority, unlike
// a warehouse's own banner which can't delete once approved).
export function AdminBannersPage() {
  const { t } = useTranslation();
  const bannerStatusLabel = useBannerStatusLabel();
  const [products, setProducts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editingBanner, setEditingBanner] = useState(null);

  useEffect(() => {
    api.adminProducts().then((data) => setProducts(data.products));
  }, []);

  const fetchPage = useCallback(
    (cursor) =>
      api.adminBanners('all', { limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.banners,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    []
  );

  const { data: banners, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: same moderation-queue reasoning as offers - a warehouse's banner
  // stays unpublished until an admin decides, and a second admin shouldn't be
  // looking at a row that's already been handled.
  useRealtimeSync(
    [REALTIME_EVENTS.BANNER_PENDING, REALTIME_EVENTS.BANNER_STATUS_UPDATED],
    () => reset()
  );

  const handleApprove = async (banner) => {
    const confirmed = window.confirm(
      t('banners.admin.confirmApprove', { title: banner.title, warehouse: banner.warehouseNameEn }),
    );
    if (!confirmed) return;

    setBusyId(banner.id);
    setActionError(null);
    try {
      await api.approveBanner(banner.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (banner) => {
    const rejectionNote = window.prompt(t('banners.admin.promptReject', { title: banner.title }));
    if (!rejectionNote || !rejectionNote.trim()) return;

    setBusyId(banner.id);
    setActionError(null);
    try {
      await api.rejectBanner(banner.id, rejectionNote.trim());
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (banner) => {
    const confirmed = window.confirm(t('banners.admin.confirmDelete', { title: banner.title }));
    if (!confirmed) return;

    setBusyId(banner.id);
    setActionError(null);
    try {
      await api.deleteAdminBanner(banner.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaved = () => {
    setEditingBanner(null);
    reset();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.banners')}</h1>
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <div className="adm-detail-grid">
          <div style={{ minWidth: 0 }}>
            {banners.length === 0 ? (
              <div className="adm-empty-state">
                <div className="adm-empty-state-icon">&#128247;</div>
                <div className="adm-empty-state-title">{t('banners.admin.noBanners')}</div>
              </div>
            ) : (
              <>
                <div className="adm-card table-scroll">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>{t('banners.admin.numberColumn')}</th>
                        <th>{t('banners.warehouse.thumbnailColumn')}</th>
                        <th>{t('banners.admin.warehouseTitleColumn')}</th>
                        <th>{t('banners.admin.rangeColumn')}</th>
                        <th>{t('common.status')}</th>
                        <th>{t('admin.pendingAccounts.actionColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {banners.map((banner) => (
                        <tr key={banner.id}>
                          <td className="adm-num">{banner.bannerNumber}</td>
                          <td>
                            <img className="adm-table-thumb" src={banner.imageUrl} alt={banner.title} />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {banner.warehouseNameEn ? (
                                <span>{banner.warehouseNameEn}</span>
                              ) : (
                                <span className="adm-tag">{t('banners.admin.adminTag')}</span>
                              )}
                            </div>
                            <div className="adm-table-sub">
                              {banner.title}
                              {banner.productNameEn && (
                                <> &middot; {withArFallback(banner.productNameEn, banner.productNameAr)}</>
                              )}
                            </div>
                            {banner.status === 'rejected' && banner.rejectionNote && (
                              <div className="adm-table-sub">
                                {t('common.rejectionReason', { reason: banner.rejectionNote })}
                              </div>
                            )}
                          </td>
                          <td className="adm-num">
                            {new Date(banner.startDate).toLocaleDateString()} &ndash;{' '}
                            {new Date(banner.endDate).toLocaleDateString()}
                          </td>
                          <td>
                            <span className={`status-badge ${bannerStatusBadgeClass(banner)}`}>
                              {bannerStatusLabel(banner)}
                            </span>
                          </td>
                          <td>
                            <div className="adm-row-actions">
                              {banner.status === 'pending' && (
                                <>
                                  <button
                                    className="btn-approve"
                                    disabled={busyId === banner.id}
                                    onClick={() => handleApprove(banner)}
                                  >
                                    {t('common.approve')}
                                  </button>
                                  <button
                                    className="btn-reject"
                                    disabled={busyId === banner.id}
                                    onClick={() => handleReject(banner)}
                                  >
                                    {t('common.reject')}
                                  </button>
                                </>
                              )}
                              {(banner.status === 'pending' || banner.status === 'approved') && (
                                <button
                                  className="adm-row-action"
                                  disabled={busyId === banner.id}
                                  onClick={() => setEditingBanner(banner)}
                                >
                                  {t('common.edit')}
                                </button>
                              )}
                              <button
                                className="adm-row-action adm-row-action-danger"
                                disabled={busyId === banner.id}
                                onClick={() => handleDelete(banner)}
                              >
                                {t('common.delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="adm-table-hint">{t('banners.admin.editDeleteHint')}</p>
                <LoadMoreControl
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={loadMore}
                  pageSize={PAGE_SIZE}
                />
              </>
            )}
          </div>

          <BannerComposer products={products} onCreated={reset} />
        </div>
      )}

      {editingBanner && (
        <EditBannerModal
          banner={editingBanner}
          onClose={() => setEditingBanner(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
