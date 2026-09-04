import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatSyp, formatUsd, formatMoneyFromUsd, sypFromUsd } from '../utils/currency';
import { AdvertisementsSubNav } from '../components/AdvertisementsSubNav';
import { withArFallback } from '../utils/displayName';
import { contactAdminOnWhatsApp } from '../utils/whatsapp';

const SEARCH_PAGE_SIZE = 10;
// Matches AdminProductsPage - long enough that typing a medicine name doesn't
// fire a request per keystroke, short enough to still feel live.
const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_FORM = {
  titleAr: '',
  titleEn: '',
  // SYP, as typed. Converted to USD only at submit - see handleSubmit.
  totalPrice: '',
  startDate: '',
  endDate: '',
};

function toDateInputValue(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

// The product picker: a debounced server-side search over this warehouse's own
// products. Deliberately never fetches the whole catalog - the list can be
// thousands of rows (see backend searchPaginatedProductsForWarehouse).
function ProductPicker({ selectedIds, onAdd }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .searchWarehouseProducts({ q: query || undefined, limit: SEARCH_PAGE_SIZE, after: cursor })
        .then((data) => ({
          rows: data.products,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        })),
    [query]
  );

  const { data: products, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  // Back to page one on every new query - the hook deliberately doesn't fetch
  // on its own, so this is also what loads the first batch on mount.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="wh-ad-picker">
      <label>
        {t('advertisements.searchProduct')}
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('advertisements.searchPlaceholder')}
        />
      </label>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : products.length === 0 ? (
        <p className="hint">{t('advertisements.noProductsFound')}</p>
      ) : (
        <>
          <ul className="wh-ad-results">
            {products.map((product) => {
              const isSelected = selectedIds.has(product.id);
              return (
                <li key={product.id} className="wh-ad-result">
                  <span className="wh-ad-result-name">
                    {withArFallback(product.nameEn, product.nameAr)}
                    <span className="wh-table-sub">
                      {withArFallback(product.manufacturerEn, product.manufacturerAr)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isSelected}
                    onClick={() => onAdd(product)}
                  >
                    {isSelected ? t('advertisements.alreadyAdded') : t('common.add')}
                  </button>
                </li>
              );
            })}
          </ul>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={SEARCH_PAGE_SIZE}
          />
        </>
      )}
    </div>
  );
}

// `advertisement` null = create, otherwise edit. A package carries no
// per-product price - each product shows its current catalog price, read-only,
// and the warehouse sets one package total (entered in SYP, converted to the
// USD the API stores the same way ProductFormModal does it).
// Step 2 of the request flow, mirroring the banner's BannerRequestSuccessModal
// - shown right after an advertisement is submitted (never on error). Payment
// and publishing still happen manually over WhatsApp with the admin; this
// carries the advertisement's number so the admin knows which submission the
// payment is for.
function AdvertisementRequestSuccessModal({ warehouseId, advertisementNumber, onClose }) {
  const { t } = useTranslation();

  const handleContactAdmin = () => {
    contactAdminOnWhatsApp(
      t('advertisements.paymentWhatsappMessage', { warehouseId, advertisementNumber })
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('advertisements.successTitle')}</h2>
        <p>{t('advertisements.successBody')}</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
          <button className="btn-approve" onClick={handleContactAdmin}>
            <img src="/images/whatsapp_icon.png" alt="" width="20" height="20" className="btn-icon" />
            {t('advertisements.contactAdmin')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdvertisementModal({ advertisement, usdToSyp, onClose, onSaved, onCreated }) {
  const { t } = useTranslation();
  const isEdit = Boolean(advertisement);

  const [form, setForm] = useState(() =>
    advertisement
      ? {
          titleAr: advertisement.titleAr,
          titleEn: advertisement.titleEn,
          totalPrice: String(sypFromUsd(advertisement.totalPriceUsd, usdToSyp) ?? ''),
          startDate: toDateInputValue(advertisement.startDate),
          endDate: toDateInputValue(advertisement.endDate),
        }
      : EMPTY_FORM
  );
  // The package-price field auto-fills with the running catalog total until
  // the warehouse types in it. On edit it starts from the stored value, so
  // it's "touched" from the outset.
  const [totalTouched, setTotalTouched] = useState(Boolean(advertisement));
  // { productId, nameAr, nameEn, priceUsd, quantity } - priceUsd is the
  // current catalog price (USD), read-only; quantity is editable, default 1.
  const [selected, setSelected] = useState(() =>
    advertisement
      ? advertisement.items.map((item) => ({
          productId: item.productId,
          nameAr: item.productNameAr,
          nameEn: item.productNameEn,
          priceUsd: item.priceUsd,
          quantity: item.quantity ?? 1,
        }))
      : []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.productId)), [selected]);

  // The products' quantity-weighted catalog total, in SYP, and the saving %
  // the package total represents against it. Informational - the backend never
  // constrains the total (a total at/above the sum just means "no saving").
  const calculatedTotalSyp = selected.reduce(
    (sum, item) => sum + (sypFromUsd(item.priceUsd, usdToSyp) ?? 0) * (Number(item.quantity) || 1),
    0
  );
  // What actually gets submitted / measured against: the typed value once the
  // warehouse has touched the field, otherwise the auto-filled calculated sum.
  const effectiveTotalSyp = totalTouched ? Number(form.totalPrice) || 0 : Math.round(calculatedTotalSyp);
  const savingPercent =
    calculatedTotalSyp > 0
      ? Math.round(((calculatedTotalSyp - effectiveTotalSyp) / calculatedTotalSyp) * 100)
      : 0;
  const noSavingWarning =
    effectiveTotalSyp > 0 && calculatedTotalSyp > 0 && effectiveTotalSyp >= calculatedTotalSyp;

  const handleTotalChange = (value) => {
    setTotalTouched(true);
    setField('totalPrice', value);
  };

  const handleAdd = (product) => {
    // The picker already disables a selected row; this is the invariant held
    // at the state level regardless of how it was called.
    if (selectedIds.has(product.id)) return;
    setSelected((prev) => [
      ...prev,
      {
        productId: product.id,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        priceUsd: product.priceUsd,
        quantity: 1,
      },
    ]);
  };

  const handleQtyChange = (productId, quantity) =>
    setSelected((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, quantity } : item))
    );

  const handleRemove = (productId) =>
    setSelected((prev) => prev.filter((item) => item.productId !== productId));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!form.titleAr.trim() || !form.titleEn.trim() || !form.startDate || !form.endDate) {
      setError(t('common.requiredFields'));
      return;
    }
    if (selected.length === 0) {
      setError(t('advertisements.atLeastOneProduct'));
      return;
    }
    for (const item of selected) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        setError(t('advertisements.quantityPositive'));
        return;
      }
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      setError(t('common.endAfterStart'));
      return;
    }
    // The package total is typed in SYP, so without a rate it can't be
    // converted into the USD the API stores.
    if (usdToSyp == null || !(Number(usdToSyp) > 0)) {
      setError(t('advertisements.rateRequired'));
      return;
    }

    // The typed value, or the auto-filled calculated sum if the warehouse
    // never touched the field.
    const totalSyp = totalTouched ? Number(form.totalPrice) : Math.round(calculatedTotalSyp);
    if (!Number.isFinite(totalSyp) || totalSyp <= 0) {
      setError(t('advertisements.totalPositive'));
      return;
    }
    const totalPriceUsd = Math.round((totalSyp / Number(usdToSyp)) * 100) / 100;
    if (totalPriceUsd < 0.01) {
      setError(t('advertisements.totalPositive'));
      return;
    }

    // A total at/above the products' sum is allowed - the warehouse was warned
    // above but is not blocked.
    const body = {
      titleAr: form.titleAr.trim(),
      titleEn: form.titleEn.trim(),
      items: selected.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      totalPriceUsd,
      startDate: form.startDate,
      endDate: form.endDate,
    };

    setIsSaving(true);
    try {
      if (isEdit) {
        await api.updateWarehouseAdvertisement(advertisement.id, body);
        onSaved();
      } else {
        const data = await api.createWarehouseAdvertisement(body);
        // Hand the number to the success modal - the same "step 2" the banner
        // flow shows, so the admin knows which submission the payment is for.
        onCreated(data.advertisement.advertisementNumber);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wh-ad-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{isEdit ? t('advertisements.editTitle') : t('advertisements.modalTitle')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <div className="form-row">
            <label>
              {t('advertisements.titleEn')}
              <input value={form.titleEn} onChange={(e) => setField('titleEn', e.target.value)} required />
            </label>
            <label>
              {t('advertisements.titleAr')}
              <input
                value={form.titleAr}
                onChange={(e) => setField('titleAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
          </div>

          <ProductPicker selectedIds={selectedIds} onAdd={handleAdd} />

          <h3 className="wh-ad-section-title">
            {t('advertisements.selectedProducts')}
            {selected.length > 0 && <span className="wh-ad-count">{selected.length}</span>}
          </h3>
          {selected.length === 0 ? (
            <p className="hint">{t('advertisements.noProductsSelected')}</p>
          ) : (
            <ul className="wh-ad-selected">
              {selected.map((item) => (
                <li key={item.productId} className="wh-ad-selected-row">
                  <span className="wh-ad-selected-name">{withArFallback(item.nameEn, item.nameAr)}</span>
                  <label className="wh-ad-qty-label">
                    {t('advertisements.quantity')}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => handleQtyChange(item.productId, e.target.value)}
                      required
                    />
                  </label>
                  <span className="wh-ad-selected-price">
                    <span className="wh-ad-price-caption">{t('advertisements.catalogPrice')}</span>
                    <span className="wh-num">
                      {formatMoneyFromUsd(
                        (item.priceUsd ?? 0) * (Number(item.quantity) || 1),
                        usdToSyp
                      )}
                    </span>
                  </span>
                  <button type="button" className="btn-reject" onClick={() => handleRemove(item.productId)}>
                    {t('common.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* The two pricing levels, deliberately shown apart: the products'
              catalog total (read-only context) and the one package price the
              warehouse sets. */}
          <div className="wh-ad-totals">
            <div className="wh-ad-total-calculated">
              <div className="wh-ad-total-label">{t('advertisements.calculatedTotal')}</div>
              <div className="wh-ad-total-value wh-num">{formatSyp(calculatedTotalSyp)}</div>
            </div>
            <label className="wh-ad-total-input">
              {t('advertisements.totalPrice')}
              <input
                type="number"
                min="1"
                step="1"
                value={totalTouched ? form.totalPrice : (Math.round(calculatedTotalSyp) || '')}
                onChange={(e) => handleTotalChange(e.target.value)}
                required
              />
            </label>
          </div>
          {savingPercent > 0 && (
            <p className="wh-ad-saving">{t('advertisements.savingPercent', { percent: savingPercent })}</p>
          )}
          {noSavingWarning && <p className="wh-ad-warn">{t('advertisements.totalNotBelowSum')}</p>}
          {usdToSyp != null && effectiveTotalSyp > 0 && (
            <p className="hint">
              {t('productForm.approxUsd', { amount: formatUsd(effectiveTotalSyp / usdToSyp) })}
            </p>
          )}
          {usdToSyp == null && <p className="hint">{t('advertisements.rateRequired')}</p>}

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
              {isSaving ? t('advertisements.submitting') : t('advertisements.submitForApproval')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A warehouse's advertisement packages: several products, a price advertised
// for each, and a package total for the whole thing. Every package is
// moderated by an admin before pharmacies see it - the warehouse never puts
// one live itself (same rule Offers and Banners follow).
export function WarehouseAdvertisementsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const { warehouse } = useAuth();
  const [advertisements, setAdvertisements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // null = closed, 'new' = create, otherwise the advertisement being edited.
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Set to a just-submitted advertisement's number -> the "contact admin to
  // pay" modal, same two-step flow the banner page has.
  const [successAdNumber, setSuccessAdNumber] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseAdvertisements();
      setAdvertisements(data.advertisements);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusBadge = (status) => {
    const className =
      status === 'approved' ? 'status-delivered' : status === 'rejected' ? 'status-cancelled' : 'status-pending';
    return <span className={`status-badge ${className}`}>{t(`advertisements.status.${status}`)}</span>;
  };

  const handleDelete = async (advertisement) => {
    if (!window.confirm(t('advertisements.confirmDelete', { title: advertisement.titleEn }))) return;
    setBusyId(advertisement.id);
    setError(null);
    try {
      await api.deleteWarehouseAdvertisement(advertisement.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaved = () => {
    setEditing(null);
    load();
  };

  const handleCreated = (advertisementNumber) => {
    setEditing(null);
    setSuccessAdNumber(advertisementNumber);
    load();
  };

  const handleRequestViaWhatsApp = () => {
    const warehouseName = withArFallback(warehouse?.nameEn, warehouse?.nameAr);
    contactAdminOnWhatsApp(t('advertisements.whatsappRequestMessage', { warehouseName }));
  };

  return (
    <div>
      <AdvertisementsSubNav basePath="/warehouse/advertisements" variant="wh" />

      <div className="wh-page-head">
        <h1>{t('nav.advertisements')}</h1>
        <button
          className="btn-primary"
          style={{ width: 'auto', marginTop: 0 }}
          onClick={() => setEditing('new')}
        >
          {t('advertisements.newAdvertisement')}
        </button>
      </div>

      <button className="btn-secondary" style={{ width: 'auto' }} onClick={handleRequestViaWhatsApp}>
        <img src="/images/whatsapp_icon.png" alt="" width="20" height="20" className="btn-icon" />
        {t('advertisements.whatsappRequest')}
      </button>

      <p className="wh-notice">{t('advertisements.approvalNotice')}</p>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : advertisements.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">📣</div>
          <div className="wh-empty-state-title">{t('advertisements.noAdvertisements')}</div>
        </div>
      ) : (
        <div className="wh-card table-scroll">
          <table className="wh-table">
            <thead>
              <tr>
                <th>{t('advertisements.numberColumn')}</th>
                <th>{t('advertisements.titleColumn')}</th>
                <th>{t('advertisements.productsColumn')}</th>
                <th>{t('advertisements.calculatedTotal')}</th>
                <th>{t('advertisements.totalPrice')}</th>
                <th>{t('offers.warehouse.fromColumn')}</th>
                <th>{t('offers.warehouse.toColumn')}</th>
                <th>{t('common.status')}</th>
                <th aria-label={t('common.edit')}></th>
              </tr>
            </thead>
            <tbody>
              {advertisements.map((advertisement) => (
                <tr key={advertisement.id}>
                  <td className="wh-num wh-table-order-num">
                    {advertisement.advertisementNumber != null ? `#${advertisement.advertisementNumber}` : '—'}
                  </td>
                  <td>
                    {advertisement.titleEn}
                    <div className="wh-table-sub" dir="rtl">
                      {advertisement.titleAr}
                    </div>
                    {advertisement.status === 'rejected' && advertisement.rejectionNote && (
                      <div className="error-text wh-table-sub">{advertisement.rejectionNote}</div>
                    )}
                  </td>
                  <td>
                    <span className="wh-ad-count">{advertisement.items.length}</span>
                    <div className="wh-table-sub">
                      {advertisement.items
                        .map(
                          (item) =>
                            `${withArFallback(item.productNameEn, item.productNameAr)} ×${item.quantity}`
                        )
                        .join(' · ')}
                    </div>
                  </td>
                  <td className="wh-num">
                    {formatMoneyFromUsd(advertisement.calculatedItemsTotalUsd, usdToSyp)}
                  </td>
                  <td className="wh-num wh-table-total">
                    {formatMoneyFromUsd(advertisement.totalPriceUsd, usdToSyp)}
                    {advertisement.savingPercentage > 0 && (
                      <div className="wh-table-sub wh-ad-saving">
                        {t('advertisements.savingPercent', { percent: advertisement.savingPercentage })}
                      </div>
                    )}
                  </td>
                  <td className="wh-num wh-table-date">
                    {new Date(advertisement.startDate).toLocaleDateString()}
                  </td>
                  <td className="wh-num wh-table-date">
                    {new Date(advertisement.endDate).toLocaleDateString()}
                  </td>
                  <td>{statusBadge(advertisement.status)}</td>
                  <td>
                    <div className="table-row-actions">
                      <button className="btn-secondary" onClick={() => setEditing(advertisement)}>
                        {t('common.edit')}
                      </button>
                      <button
                        className="btn-reject"
                        disabled={busyId === advertisement.id}
                        onClick={() => handleDelete(advertisement)}
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
      )}

      {editing && (
        <AdvertisementModal
          advertisement={editing === 'new' ? null : editing}
          usdToSyp={usdToSyp}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onCreated={handleCreated}
        />
      )}

      {successAdNumber != null && (
        <AdvertisementRequestSuccessModal
          warehouseId={warehouse?.id}
          advertisementNumber={successAdNumber}
          onClose={() => setSuccessAdNumber(null)}
        />
      )}
    </div>
  );
}
