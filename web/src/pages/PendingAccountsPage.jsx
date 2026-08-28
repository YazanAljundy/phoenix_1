import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';

const PAGE_SIZE = 20;

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

function accountCity(account) {
  return account.pharmacy?.city || account.warehouse?.city || '-';
}

// Section 7: the admin onboarding a warehouse directly, as opposed to
// approving one that self-registered (the table below). The account comes
// back already active, so there's no second approval step - it never lands
// in the pending queue at all.
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

export function PendingAccountsPage() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [activeRole, setActiveRole] = useState('pharmacy');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [showNewWarehouse, setShowNewWarehouse] = useState(false);
  const [newWarehouseCredentials, setNewWarehouseCredentials] = useState(null);
  // The tab counts must stay accurate for both roles at once, independent of
  // which tab is loaded/paginated - the backend returns both on every
  // request, regardless of which role was asked for.
  const [pharmacyCount, setPharmacyCount] = useState(0);
  const [warehouseCount, setWarehouseCount] = useState(0);

  const fetchPage = useCallback(
    (cursor) =>
      api.pendingAccounts({ role: activeRole, limit: PAGE_SIZE, after: cursor }).then((data) => {
        setPharmacyCount(data.pharmacyCount);
        setWarehouseCount(data.warehouseCount);
        return {
          rows: data.accounts,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        };
      }),
    [activeRole]
  );

  const {
    data: visibleAccounts,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    reset,
  } = usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole]);

  // Realtime: a pharmacy that just registered is blocked from ordering until
  // someone here approves it, so this queue going stale has a real cost at the
  // other end. `reset()` re-reads the active role's page one and, with it, the
  // pharmacy/warehouse tab counts the backend returns on every request - so
  // the inactive tab's badge stays correct too.
  useRealtimeSync(
    [REALTIME_EVENTS.ACCOUNT_PENDING, REALTIME_EVENTS.ACCOUNT_STATUS_UPDATED],
    () => reset()
  );

  const handleDecision = async (account, action) => {
    const confirmed = window.confirm(
      t('admin.pendingAccounts.confirmDecision', {
        action: action === 'approve' ? t('common.approve') : t('common.reject'),
        name: accountName(account),
      }),
    );
    if (!confirmed) return;

    setBusyId(account.user.id);
    setActionError(null);
    try {
      if (action === 'approve') {
        await api.approveAccount(account.user.id);
      } else {
        await api.rejectAccount(account.user.id);
      }
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.pendingAccounts')}</h1>
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

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            <button
              type="button"
              className={`adm-pill${activeRole === 'pharmacy' ? ' active' : ''}`}
              onClick={() => setActiveRole('pharmacy')}
            >
              {t('admin.pendingAccounts.pharmaciesTab', { count: pharmacyCount })}
            </button>
            <button
              type="button"
              className={`adm-pill${activeRole === 'warehouse' ? ' active' : ''}`}
              onClick={() => setActiveRole('warehouse')}
            >
              {t('admin.pendingAccounts.warehousesTab', { count: warehouseCount })}
            </button>
          </div>

          {visibleAccounts.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#10003;</div>
              <div className="adm-empty-state-title">{t('admin.pendingAccounts.noAccounts')}</div>
              <div className="adm-empty-state-body">{t('admin.pendingAccounts.noAccountsHint')}</div>
            </div>
          ) : (
            <>
              <div className="adm-card table-scroll">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>{t('admin.pendingAccounts.nameColumn')}</th>
                      <th>{t('admin.pendingAccounts.phoneColumn')}</th>
                      <th>{t('admin.pendingAccounts.cityColumn')}</th>
                      {activeRole === 'pharmacy' && <th>{t('admin.pendingAccounts.verificationColumn')}</th>}
                      <th>{t('admin.pendingAccounts.actionColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAccounts.map((account) => (
                      <tr key={account.user.id}>
                        <td>
                          {accountName(account)}
                          {account.pharmacy?.ownerName && (
                            <div className="adm-table-sub">{account.pharmacy.ownerName}</div>
                          )}
                        </td>
                        <td className="adm-num">{account.user.phone}</td>
                        <td>{accountCity(account)}</td>
                        {activeRole === 'pharmacy' && (
                          <td>
                            {account.pharmacy?.verificationPhoto ? (
                              <button
                                type="button"
                                className="adm-table-thumb-button"
                                onClick={() => setLightboxUrl(account.pharmacy.verificationPhoto)}
                              >
                                <img
                                  className="adm-table-thumb"
                                  src={account.pharmacy.verificationPhoto}
                                  alt="Verification"
                                />
                              </button>
                            ) : (
                              <span className="hint">&mdash;</span>
                            )}
                          </td>
                        )}
                        <td>
                          <div className="adm-row-actions">
                            <button
                              className="btn-approve"
                              disabled={busyId === account.user.id}
                              onClick={() => handleDecision(account, 'approve')}
                            >
                              {t('common.approve')}
                            </button>
                            <button
                              className="btn-reject"
                              disabled={busyId === account.user.id}
                              onClick={() => handleDecision(account, 'reject')}
                            >
                              {t('common.reject')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeRole === 'pharmacy' && <p className="adm-table-hint">{t('admin.pendingAccounts.photoHint')}</p>}
              <LoadMoreControl
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
                pageSize={PAGE_SIZE}
              />
            </>
          )}
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
          }}
        />
      )}
    </div>
  );
}
