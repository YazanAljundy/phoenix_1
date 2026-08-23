import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { withArFallback } from '../utils/displayName';

// Placeholder for testing - replace with the admin's real WhatsApp number
// (digits only, country code, no leading + or spaces, e.g. "963911234567").
const ADMIN_WHATSAPP_NUMBER = '963900000000';

const PAGE_SIZE = 15;

const EMPTY_BANNER_FORM = { imageFile: null, title: '', productId: '', startDate: '', endDate: '' };

function bannerFormFromBanner(banner) {
  return {
    imageFile: null,
    title: banner.title,
    productId: banner.productId ?? '',
    startDate: banner.startDate.slice(0, 10),
    endDate: banner.endDate.slice(0, 10),
  };
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

// Doubles as the edit form (per the request: "opens the same creation form,
// filled with current data") - `editingBanner` null means create. The image
// is never editable either way: create requires a fresh upload, edit shows
// the existing one read-only with no file input at all.
function CreateBannerModal({ products, editingBanner, onClose, onCreated, onSaved }) {
  const { t } = useTranslation();
  const isEditing = Boolean(editingBanner);
  const [form, setForm] = useState(isEditing ? bannerFormFromBanner(editingBanner) : EMPTY_BANNER_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if ((!isEditing && !form.imageFile) || !form.title.trim() || !form.startDate || !form.endDate) {
      setError(t('common.requiredFields'));
      return;
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      setError(t('common.endAfterStart'));
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing) {
        await api.updateWarehouseBanner(editingBanner.id, {
          title: form.title.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          productId: form.productId || null,
        });
        onSaved();
      } else {
        const formData = new FormData();
        formData.append('image', form.imageFile);
        formData.append('title', form.title.trim());
        formData.append('startDate', form.startDate);
        formData.append('endDate', form.endDate);
        if (form.productId) formData.append('productId', form.productId);
        const data = await api.createWarehouseBanner(formData);
        onCreated(data.banner.bannerNumber);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{isEditing ? t('banners.warehouse.editBanner') : t('banners.warehouse.modalTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          {isEditing ? (
            <img
              className="return-photo-thumb"
              src={editingBanner.imageUrl}
              alt={editingBanner.title}
              style={{ width: 96, height: 96 }}
            />
          ) : (
            <label>
              {t('banners.image')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setField('imageFile', e.target.files?.[0] ?? null)}
                required
              />
            </label>
          )}
          <label>
            {t('banners.title')}
            <input value={form.title} onChange={(e) => setField('title', e.target.value)} required />
          </label>
          <label>
            {t('banners.linkedProductOptional')}
            <select value={form.productId} onChange={(e) => setField('productId', e.target.value)}>
              <option value="">{t('banners.noProduct')}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {withArFallback(product.nameEn, product.nameAr)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              {t('common.startDate')}
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
                required
              />
            </label>
            <label>
              {t('common.endDate')}
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
                required
              />
            </label>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isEditing
                ? isSaving
                  ? t('common.saving')
                  : t('common.save')
                : isSaving
                  ? t('banners.publishing')
                  : t('banners.submitForApproval')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Step 2 of the request flow - shown automatically right after a banner is
// successfully submitted (never on error). Payment/publishing itself still
// happens manually over WhatsApp with the admin, same as the general
// "request a banner" button above; this one carries the specific banner's
// number so the admin knows which submission the payment is for.
function BannerRequestSuccessModal({ warehouseId, bannerNumber, onClose }) {
  const { t } = useTranslation();

  const handleContactAdmin = () => {
    const text = t('banners.warehouse.paymentWhatsappMessage', { warehouseId, bannerNumber });
    window.open(`https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noreferrer');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('banners.warehouse.successTitle')}</h2>
        <p>{t('banners.warehouse.successBody')}</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
          <button className="btn-approve" onClick={handleContactAdmin}>
            {t('banners.warehouse.contactAdmin')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WarehouseBannersPage() {
  const { t } = useTranslation();
  const bannerStatusLabel = useBannerStatusLabel();
  const { warehouse } = useAuth();
  const [products, setProducts] = useState([]);
  const [showCreateBanner, setShowCreateBanner] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);
  const [busyBannerId, setBusyBannerId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [successBannerNumber, setSuccessBannerNumber] = useState(null);

  useEffect(() => {
    api.warehouseProducts().then((data) => setProducts(data.products));
  }, []);

  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseBanners({ limit: PAGE_SIZE, after: cursor }).then((data) => ({
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

  const handleBannerCreated = (bannerNumber) => {
    setShowCreateBanner(false);
    setSuccessBannerNumber(bannerNumber);
    reset();
  };

  const handleBannerSaved = () => {
    setEditingBanner(null);
    reset();
  };

  const handleRequestBannerViaWhatsApp = () => {
    const warehouseName = withArFallback(warehouse?.nameEn, warehouse?.nameAr);
    const text = `مرحباً، أريد نشر إعلان جديد.${warehouseName ? `\nاسم المستودع: ${warehouseName}` : ''}`;
    window.open(`https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noreferrer');
  };

  const handleDeleteBanner = async (banner) => {
    const confirmed = window.confirm(t('banners.warehouse.confirmDelete', { title: banner.title }));
    if (!confirmed) return;

    setBusyBannerId(banner.id);
    setActionError(null);
    try {
      await api.deleteWarehouseBanner(banner.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyBannerId(null);
    }
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.banners')}</h1>
        <button
          className="btn-primary"
          style={{ width: 'auto', marginTop: 0 }}
          onClick={() => setShowCreateBanner(true)}
        >
          {t('banners.warehouse.newBanner')}
        </button>
      </div>

      <button className="btn-secondary" style={{ width: 'auto' }} onClick={handleRequestBannerViaWhatsApp}>
        {t('banners.warehouse.whatsappRequest')}
      </button>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : banners.length === 0 ? (
        <p className="hint">{t('banners.warehouse.noBanners')}</p>
      ) : (
        <>
          <div className="wh-card table-scroll" style={{ marginTop: 16 }}>
            <table className="wh-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('banners.warehouse.thumbnailColumn')}</th>
                  <th>{t('banners.title')}</th>
                  <th>{t('offers.warehouse.fromColumn')}</th>
                  <th>{t('offers.warehouse.toColumn')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('orders.actionColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {banners.map((banner) => (
                  <tr key={banner.id}>
                    <td className="wh-num wh-table-order-num">#{banner.bannerNumber}</td>
                    <td>
                      <img className="wh-table-thumb" src={banner.imageUrl} alt={banner.title} />
                    </td>
                    <td>
                      {banner.title}
                      {banner.status === 'rejected' && banner.rejectionNote && (
                        <div className="wh-table-sub">
                          {t('common.rejectionReason', { reason: banner.rejectionNote })}
                        </div>
                      )}
                    </td>
                    <td className="wh-num wh-table-date">{new Date(banner.startDate).toLocaleDateString()}</td>
                    <td className="wh-num wh-table-date">{new Date(banner.endDate).toLocaleDateString()}</td>
                    <td>
                      <span className={`status-badge ${bannerStatusBadgeClass(banner)}`}>
                        {bannerStatusLabel(banner)}
                      </span>
                    </td>
                    <td>
                      {banner.status === 'approved' ? (
                        <span className="hint">{t('banners.warehouse.cannotEditPublished')}</span>
                      ) : (
                        <div className="wh-row-actions">
                          <button onClick={() => setEditingBanner(banner)}>{t('common.edit')}</button>
                          <button
                            className="wh-row-action-danger"
                            disabled={busyBannerId === banner.id}
                            onClick={() => handleDeleteBanner(banner)}
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
          <p className="wh-table-hint">{t('banners.warehouse.editDeleteHint')}</p>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
        </>
      )}

      {showCreateBanner && (
        <CreateBannerModal
          products={products}
          onClose={() => setShowCreateBanner(false)}
          onCreated={handleBannerCreated}
        />
      )}

      {editingBanner && (
        <CreateBannerModal
          products={products}
          editingBanner={editingBanner}
          onClose={() => setEditingBanner(null)}
          onSaved={handleBannerSaved}
        />
      )}

      {successBannerNumber && (
        <BannerRequestSuccessModal
          warehouseId={warehouse?.id}
          bannerNumber={successBannerNumber}
          onClose={() => setSuccessBannerNumber(null)}
        />
      )}
    </div>
  );
}
