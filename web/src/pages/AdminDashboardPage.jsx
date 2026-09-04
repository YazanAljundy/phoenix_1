import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';

function accountName(account) {
  return account.pharmacy?.nameEn || account.warehouse?.nameEn || account.user.name;
}

function accountCity(account) {
  const profile = account.pharmacy || account.warehouse;
  return profile?.city ?? '-';
}

// Section 13c: an overview landing screen built entirely from data the other
// admin pages already fetch (pending accounts/offers/banners, the products
// list, the exchange rate) - no new endpoint, this just aggregates and
// summarizes what's already there. There's no cross-warehouse "recent
// orders" endpoint for the admin role, so unlike the mockup this shows
// recent pending offers as the second list instead - still "things that
// just happened and may need a decision," using only data that already
// exists.
export function AdminDashboardPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [pendingBannersCount, setPendingBannersCount] = useState(0);
  const [productsCount, setProductsCount] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsData, offersData, bannersData, productsData, rateData] = await Promise.all([
        api.pendingAccounts(),
        api.pendingOffers(),
        api.adminBanners('pending'),
        api.adminProducts(),
        api.adminExchangeRate(),
      ]);
      setAccounts(accountsData.accounts);
      setOffers(offersData.offers);
      setPendingBannersCount(bannersData.banners.length);
      setProductsCount(productsData.products.length);
      setExchangeRate(rateData.exchangeRate);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: every stat card and both recent-lists on this screen are
  // derived from the three admin queues, so any of these six events makes the
  // whole aggregate stale. `load()` is the page's own existing refetch - the
  // five parallel REST calls stay the source of truth, the socket only decides
  // when to re-run them. RealtimeClient already collapses a burst into one
  // call and fires this again after a reconnect.
  useRealtimeSync(
    [
      REALTIME_EVENTS.ACCOUNT_PENDING,
      REALTIME_EVENTS.ACCOUNT_STATUS_UPDATED,
      REALTIME_EVENTS.OFFER_PENDING,
      REALTIME_EVENTS.OFFER_STATUS_UPDATED,
      REALTIME_EVENTS.BANNER_PENDING,
      REALTIME_EVENTS.BANNER_STATUS_UPDATED,
    ],
    load
  );

  const stats = [
    {
      key: 'pendingAccounts',
      label: t('nav.pendingAccounts'),
      value: accounts.length,
      to: '/admin/accounts',
      tone: 'pending',
    },
    { key: 'pendingOffers', label: t('nav.offers'), value: offers.length, to: '/admin/offers', tone: 'info' },
    {
      key: 'pendingBanners',
      // Banners are now the "general" half of the merged Advertisements tab.
      label: t('nav.advertisementsGeneral'),
      value: pendingBannersCount,
      to: '/admin/advertisements/general',
      tone: 'success',
    },
    { key: 'products', label: t('nav.products'), value: productsCount, to: '/admin/products', tone: 'navy' },
  ];

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.dashboard')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-stats-grid">
            {stats.map((s) => (
              <Link to={s.to} key={s.key} className={`adm-stat-card adm-stat-${s.tone}`}>
                <div className="adm-stat-label">{s.label}</div>
                <div className="adm-stat-value adm-num">{s.value}</div>
                <div className="adm-stat-hint">{t('dashboard.viewAll')}</div>
              </Link>
            ))}
          </div>

          <div className="adm-dashboard-columns">
            <div className="adm-card">
              <div className="adm-card-head">
                <span>{t('dashboard.recentAccountsTitle')}</span>
                <Link to="/admin/accounts">{t('dashboard.viewAll')}</Link>
              </div>
              {accounts.length === 0 ? (
                <p className="hint" style={{ padding: 16 }}>
                  {t('admin.pendingAccounts.noAccounts')}
                </p>
              ) : (
                accounts.slice(0, 5).map((account) => (
                  <div className="adm-list-row" key={account.user.id}>
                    <div className="adm-list-row-main">
                      <div className="adm-list-row-title">{accountName(account)}</div>
                      <div className="adm-list-row-sub">
                        {account.user.role} &middot; {accountCity(account)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="adm-card">
              <div className="adm-card-head">
                <span>{t('dashboard.recentOffersTitle')}</span>
                <Link to="/admin/offers">{t('dashboard.viewAll')}</Link>
              </div>
              {offers.length === 0 ? (
                <p className="hint" style={{ padding: 16 }}>
                  {t('offers.admin.noOffers')}
                </p>
              ) : (
                offers.slice(0, 5).map((offer) => (
                  <div className="adm-list-row" key={offer.id}>
                    <div className="adm-list-row-main">
                      <div className="adm-list-row-title">{offer.titleEn}</div>
                      <div className="adm-list-row-sub">{offer.warehouseNameEn}</div>
                    </div>
                    <div className="adm-list-row-end adm-num">
                      {t('offers.percentOff', { percent: offer.discountPercentage })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {exchangeRate?.usdToSyp != null && (
            <div className="adm-exchange-footer">
              {t('admin.exchangeRate.title')}:{' '}
              <strong className="adm-num">
                {t('admin.exchangeRate.rateValue', { rate: exchangeRate.usdToSyp })}
              </strong>
            </div>
          )}
        </>
      )}
    </div>
  );
}
