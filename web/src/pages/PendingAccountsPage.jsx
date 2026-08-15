import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

function accountName(account) {
  return account.pharmacy?.nameEn || account.warehouse?.nameEn || account.user.name;
}

function accountAddress(account) {
  const profile = account.pharmacy || account.warehouse;
  if (!profile) return '-';
  return `${profile.address ?? ''}${profile.city ? `, ${profile.city}` : ''}`;
}

export function PendingAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.pendingAccounts();
      setAccounts(data.accounts);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (account, action) => {
    const confirmed = window.confirm(
      `${action === 'approve' ? 'Approve' : 'Reject'} ${accountName(account)}?`,
    );
    if (!confirmed) return;

    setBusyId(account.user.id);
    setError(null);
    try {
      if (action === 'approve') {
        await api.approveAccount(account.user.id);
      } else {
        await api.rejectAccount(account.user.id);
      }
      setAccounts((prev) => prev.filter((a) => a.user.id !== account.user.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : accounts.length === 0 ? (
        <p className="hint">No pending accounts right now.</p>
      ) : (
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-card" key={account.user.id}>
              {account.pharmacy?.verificationPhoto && (
                <img
                  className="account-verification-photo"
                  src={account.pharmacy.verificationPhoto}
                  alt="Pharmacy verification"
                />
              )}
              <div className="account-info">
                <span className="account-role-badge">{account.user.role}</span>
                <h2>{accountName(account)}</h2>
                <p>{account.user.phone}</p>
                <p>{accountAddress(account)}</p>
              </div>
              <div className="account-actions">
                <button
                  className="btn-approve"
                  disabled={busyId === account.user.id}
                  onClick={() => handleDecision(account, 'approve')}
                >
                  Approve
                </button>
                <button
                  className="btn-reject"
                  disabled={busyId === account.user.id}
                  onClick={() => handleDecision(account, 'reject')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
