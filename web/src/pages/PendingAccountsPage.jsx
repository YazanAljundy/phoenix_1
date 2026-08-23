import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';

const PAGE_SIZE = 20;

function accountName(account) {
  return account.pharmacy?.nameEn || account.warehouse?.nameEn || account.user.name;
}

function accountCity(account) {
  return account.pharmacy?.city || account.warehouse?.city || '-';
}

export function PendingAccountsPage() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [activeRole, setActiveRole] = useState('pharmacy');
  const [lightboxUrl, setLightboxUrl] = useState(null);
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
      </div>

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
    </div>
  );
}
