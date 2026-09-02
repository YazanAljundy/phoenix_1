import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { ACCOUNT_TYPES, coerceStatusForType, statusOptionsForType } from './accountsFilters';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_WAREHOUSE_FORM = {
  ownerName: '',
  phone: '',
  password: '',
  nameAr: '',
  nameEn: '',
  city: '',
  address: '',
  deliveryType: 'self',
};

function accountName(account) {
  return account.pharmacy?.nameEn || account.warehouse?.nameEn || account.user.name;
}

// active -> the green "delivered" tone, pending -> amber, blocked -> the red
// "cancelled" tone. The admin shell only ships these three status-badge tones
// (index.css), and they line up cleanly with the three account states.
function statusBadgeClass(status) {
  if (status === 'active') return 'status-delivered';
  if (status === 'blocked') return 'status-cancelled';
  return 'status-pending';
}

// Section 7: the admin onboarding a warehouse directly, as opposed to
// approving one that self-registered. The account comes back already active, so
// there's no second approval step - it never lands in the pending queue at all.
//
// The password is only ever held here in the admin's own browser: the create
// response deliberately doesn't echo it back (see admin.controller.js), so
// `onCreated` hands the typed value straight to the success panel. Once that
// panel is dismissed it's unrecoverable, which is why the panel says so.
function NewWarehouseModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_WAREHOUSE_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const required = ['ownerName', 'phone', 'password', 'nameAr', 'city', 'address'];
    if (required.some((field) => !form[field].trim())) {
      setError(t('common.requiredFields'));
      return;
    }

    setIsSaving(true);
    try {
      const created = await api.createAdminWarehouse({
        ownerName: form.ownerName.trim(),
        phone: form.phone.trim(),
        password: form.password,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim() || undefined,
        city: form.city.trim(),
        address: form.address.trim(),
        deliveryType: form.deliveryType,
      });
      onCreated({ nameAr: created.nameAr, phone: created.phone, password: form.password });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('admin.newWarehouse.modalTitle')}</h2>
        <p className="hint">{t('admin.newWarehouse.modalHint')}</p>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('admin.newWarehouse.ownerNameLabel')}
            <input value={form.ownerName} onChange={(e) => setField('ownerName', e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              {t('admin.newWarehouse.phoneLabel')}
              <input
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                dir="ltr"
                required
              />
            </label>
            <label>
              {t('admin.newWarehouse.passwordLabel')}
              <input
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                dir="ltr"
                required
              />
            </label>
          </div>
          <p className="hint">{t('admin.newWarehouse.passwordHint')}</p>
          <div className="form-row">
            <label>
              {t('admin.newWarehouse.nameArLabel')}
              <input
                value={form.nameAr}
                onChange={(e) => setField('nameAr', e.target.value)}
                dir="rtl"
                required
              />
            </label>
            <label>
              {t('admin.newWarehouse.nameEnLabel')}
              <input value={form.nameEn} onChange={(e) => setField('nameEn', e.target.value)} dir="ltr" />
            </label>
          </div>
          <div className="form-row">
            <label>
              {t('admin.newWarehouse.cityLabel')}
              <input value={form.city} onChange={(e) => setField('city', e.target.value)} required />
            </label>
            <label>
              {t('admin.newWarehouse.addressLabel')}
              <input value={form.address} onChange={(e) => setField('address', e.target.value)} required />
            </label>
          </div>
          <label>
            {t('admin.newWarehouse.deliveryTypeLabel')}
            <select value={form.deliveryType} onChange={(e) => setField('deliveryType', e.target.value)}>
              <option value="self">{t('admin.newWarehouse.deliverySelf')}</option>
              <option value="third_party">{t('admin.newWarehouse.deliveryThirdParty')}</option>
            </select>
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('admin.newWarehouse.creating') : t('admin.newWarehouse.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Shown on the page (not in the modal) once creation succeeds, so the
// credentials stay readable while the admin copies them out. Plain selectable
// text, never a masked field - the admin has to be able to read this to pass
// it on, and it's the only time the password is ever visible.
function NewWarehouseSuccess({ credentials, onDismiss }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = `${t('admin.newWarehouse.credentialsPhone')}: ${credentials.phone}\n${t('admin.newWarehouse.credentialsPassword')}: ${credentials.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked (insecure context, denied
      // permission) - the credentials are plainly visible and selectable
      // above regardless, so there's nothing to recover from here.
    }
  };

  return (
    <div className="adm-credentials-panel">
      <div className="adm-credentials-title">
        {t('admin.newWarehouse.successTitle')} &mdash; {credentials.nameAr}
      </div>
      <div className="adm-credentials-grid">
        <div>
          <div className="adm-credentials-label">{t('admin.newWarehouse.credentialsPhone')}</div>
          <div className="adm-credentials-value" dir="ltr">
            {credentials.phone}
          </div>
        </div>
        <div>
          <div className="adm-credentials-label">{t('admin.newWarehouse.credentialsPassword')}</div>
          <div className="adm-credentials-value" dir="ltr">
            {credentials.password}
          </div>
        </div>
      </div>
      <div className="adm-credentials-hint">{t('admin.newWarehouse.successHint')}</div>
      <div className="adm-credentials-actions">
        <button type="button" className="adm-row-action" onClick={handleCopy}>
          {copied ? t('admin.newWarehouse.copied') : t('admin.newWarehouse.copyCredentials')}
        </button>
        <button type="button" className="adm-row-action" onClick={onDismiss}>
          {t('admin.newWarehouse.done')}
        </button>
      </div>
    </div>
  );
}

// Section 3: the full Accounts management section - pharmacies and warehouses,
// every status, with type + status + server-side search filters and the same
// cursor "Load more" pagination the other admin lists use. Replaces the old
// pending-only queue (the Dashboard still has its own pending view).
export function AccountsPage() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all'); // all | pharmacy | warehouse
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | pending | blocked
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [showNewWarehouse, setShowNewWarehouse] = useState(false);
  const [newWarehouseCredentials, setNewWarehouseCredentials] = useState(null);
  // Per-status totals for the pills - the backend returns them on every request,
  // scoped to the current type + search, independent of pagination.
  const [counts, setCounts] = useState({ all: 0, active: 0, pending: 0, blocked: 0 });

  // Debounced so typing doesn't fire a request per keystroke - the search runs
  // server-side (see admin.service.listAccounts). Same pattern as
  // AdminProductsPage.
  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const statusOptions = useMemo(() => statusOptionsForType(typeFilter), [typeFilter]);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .adminAccounts({
          role: typeFilter === 'all' ? undefined : typeFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: searchQuery || undefined,
          limit: PAGE_SIZE,
          after: cursor,
        })
        .then((data) => {
          if (data.counts) setCounts(data.counts);
          return {
            rows: data.accounts,
            hasMore: data.pagination.hasMore,
            nextCursor: data.pagination.nextCursor,
          };
        }),
    [typeFilter, statusFilter, searchQuery]
  );

  const {
    data: accounts,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    reset,
  } = usePaginatedData(fetchPage);

  // Any filter/search change re-reads page one (Sections 5+6): the cursor is
  // dropped and the list starts over.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, searchQuery]);

  // Realtime: a pharmacy registering, an admin approving/rejecting/blocking/
  // unblocking, or a warehouse being added all change this list (and the
  // counts). `reset()` re-reads the current filtered query - REST stays
  // authoritative. RealtimeClient already collapses a burst into one call and
  // fires this again after a reconnect.
  useRealtimeSync(
    [REALTIME_EVENTS.ACCOUNT_PENDING, REALTIME_EVENTS.ACCOUNT_STATUS_UPDATED],
    () => reset()
  );

  const handleTypeChange = (nextType) => {
    setTypeFilter(nextType);
    setStatusFilter((current) => coerceStatusForType(nextType, current));
  };

  const runAction = async (account, action, confirmMessage) => {
    if (!window.confirm(confirmMessage)) return;
    setBusyId(account.user.id);
    setActionError(null);
    try {
      await action(account.user.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = (account) =>
    runAction(account, api.approveAccount, t('admin.accounts.confirmApprove', { name: accountName(account) }));
  const handleReject = (account) =>
    runAction(account, api.rejectAccount, t('admin.accounts.confirmReject', { name: accountName(account) }));
  const handleBlock = (account) =>
    runAction(account, api.blockAccount, t('admin.accounts.confirmBlock', { name: accountName(account) }));
  const handleUnblock = (account) =>
    runAction(account, api.unblockAccount, t('admin.accounts.confirmUnblock', { name: accountName(account) }));

  const renderActions = (account) => {
    const { id, role, status } = account.user;
    const busy = busyId === id;

    if (role === 'pharmacy' && status === 'pending') {
      return (
        <div className="adm-row-actions">
          {account.pharmacy?.verificationPhoto && (
            <button
              type="button"
              className="adm-row-action"
              onClick={() => setLightboxUrl(account.pharmacy.verificationPhoto)}
            >
              {t('admin.accounts.action.view')}
            </button>
          )}
          <button className="btn-approve" disabled={busy} onClick={() => handleApprove(account)}>
            {t('common.approve')}
          </button>
          <button className="btn-reject" disabled={busy} onClick={() => handleReject(account)}>
            {t('common.reject')}
          </button>
        </div>
      );
    }

    if (status === 'active') {
      return (
        <div className="adm-row-actions">
          <button
            className="adm-row-action adm-row-action-danger"
            disabled={busy}
            onClick={() => handleBlock(account)}
          >
            {t('admin.accounts.action.block')}
          </button>
        </div>
      );
    }

    if (status === 'blocked') {
      return (
        <div className="adm-row-actions">
          <button className="adm-row-action" disabled={busy} onClick={() => handleUnblock(account)}>
            {t('admin.accounts.action.unblock')}
          </button>
        </div>
      );
    }

    return <span className="hint">&mdash;</span>;
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.accounts')}</h1>
        <div className="adm-page-head-actions">
          <button className="btn-primary" onClick={() => setShowNewWarehouse(true)}>
            {t('admin.newWarehouse.button')}
          </button>
        </div>
      </div>

      {newWarehouseCredentials && (
        <NewWarehouseSuccess
          credentials={newWarehouseCredentials}
          onDismiss={() => setNewWarehouseCredentials(null)}
        />
      )}

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      <div className="adm-pills">
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            className={`adm-pill${statusFilter === status ? ' active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {t(`admin.accounts.status.${status}`)} ({counts[status] ?? 0})
          </button>
        ))}
      </div>

      <div className="adm-account-type-filter">
        <span className="adm-account-type-label">{t('admin.accounts.typeLabel')}</span>
        <div className="adm-pills">
          {ACCOUNT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`adm-pill${typeFilter === type ? ' active' : ''}`}
              onClick={() => handleTypeChange(type)}
            >
              {t(`admin.accounts.type.${type}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="adm-filters-row">
        <input
          type="text"
          className="adm-filter-search"
          placeholder={t('admin.accounts.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : accounts.length === 0 ? (
        <div className="adm-empty-state">
          <div className="adm-empty-state-icon">&#128100;</div>
          <div className="adm-empty-state-title">{t('admin.accounts.noAccounts')}</div>
          <div className="adm-empty-state-body">{t('admin.accounts.noAccountsHint')}</div>
        </div>
      ) : (
        <>
          <div className="adm-card table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t('admin.accounts.column.account')}</th>
                  <th>{t('admin.accounts.column.type')}</th>
                  <th>{t('admin.accounts.column.status')}</th>
                  <th>{t('admin.accounts.column.created')}</th>
                  <th>{t('admin.accounts.column.action')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.user.id}>
                    <td>
                      {accountName(account)}
                      {account.pharmacy?.ownerName && (
                        <div className="adm-table-sub">{account.pharmacy.ownerName}</div>
                      )}
                      <div className="adm-table-sub adm-num" dir="ltr">
                        {account.user.phone}
                      </div>
                    </td>
                    <td>
                      <span className="adm-tag">
                        {t(`admin.accounts.typeBadge.${account.user.role}`)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(account.user.status)}`}>
                        {t(`admin.accounts.status.${account.user.status}`)}
                      </span>
                    </td>
                    <td className="adm-num">
                      {account.user.createdAt
                        ? new Date(account.user.createdAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td>{renderActions(account)}</td>
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

      {lightboxUrl && (
        <div className="modal-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Verification" className="return-photo-lightbox-image" />
        </div>
      )}

      {showNewWarehouse && (
        <NewWarehouseModal
          onClose={() => setShowNewWarehouse(false)}
          onCreated={(credentials) => {
            setShowNewWarehouse(false);
            setNewWarehouseCredentials(credentials);
            reset();
          }}
        />
      )}
    </div>
  );
}
