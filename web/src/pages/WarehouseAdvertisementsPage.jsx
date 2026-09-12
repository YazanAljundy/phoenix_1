import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatMoneyFromUsd } from '../utils/currency';
import { AdvertisementsSubNav } from '../components/AdvertisementsSubNav';
import { AdvertisementFormModal } from '../components/AdvertisementFormModal';
import { WarehouseGroupSubNav } from '../components/WarehouseGroupSubNav';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';
import { contactAdminOnWhatsApp } from '../utils/whatsapp';

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

// A warehouse's advertisement packages: several products, a price advertised
// for each, and a package total for the whole thing. Every package is
// moderated by an admin before pharmacies see it - the warehouse never puts
// one live itself (same rule Offers and Banners follow).
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'];

export function WarehouseAdvertisementsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const { warehouse } = useAuth();
  const [advertisements, setAdvertisements] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
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
      const data = await api.warehouseAdvertisements({
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setAdvertisements(data.advertisements);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // An admin re-enabling (or pausing) one of this warehouse's packages is the
  // one change to this list that happens somewhere else - re-read it then.
  useRealtimeSync([REALTIME_EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED], () => load());

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

  // Either direction, same as the admin page's own toggle. Pausing asks
  // first - it pulls the package from every pharmacy at once - while making
  // it available again does not. Restricted server-side to an approved
  // package (ADVERTISEMENT_NOT_APPROVED otherwise), so this button only ever
  // renders while status === 'approved' (see the row actions below).
  const handleToggleAvailability = async (advertisement) => {
    const nextIsAvailable = !advertisement.isAvailable;
    if (!nextIsAvailable && !window.confirm(t('advertisements.confirmPause', { title: advertisement.titleEn }))) {
      return;
    }
    setBusyId(advertisement.id);
    setError(null);
    try {
      await api.setWarehouseAdvertisementAvailability(advertisement.id, nextIsAvailable);
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
      {/* Two rows: the Promotions group this page belongs to, then this page's
          own two halves. Only the lower one carries a divider. */}
      <WarehouseGroupSubNav />
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

      <div className="wh-filters">
        <select
          className="wh-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {filter === 'all' ? t('advertisements.filterAll') : t(`advertisements.status.${filter}`)}
            </option>
          ))}
        </select>
      </div>

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
                  <td>
                    {statusBadge(advertisement.status)}
                    {/* Its own line under the status: pausing is a separate
                        layer on top of approval, not a status of its own. */}
                    {!advertisement.isAvailable && (
                      <div className="wh-table-sub">
                        <span className="availability-badge availability-paused">
                          {t('advertisements.paused')}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="table-row-actions">
                      <button className="btn-secondary" onClick={() => setEditing(advertisement)}>
                        {t('common.edit')}
                      </button>
                      {advertisement.status === 'approved' && (
                        <button
                          className="btn-secondary"
                          disabled={busyId === advertisement.id}
                          onClick={() => handleToggleAvailability(advertisement)}
                        >
                          {advertisement.isAvailable
                            ? t('advertisements.pause')
                            : t('advertisements.admin.makeAvailable')}
                        </button>
                      )}
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
        <AdvertisementFormModal
          advertisement={editing === 'new' ? null : editing}
          usdToSyp={usdToSyp}
          onClose={() => setEditing(null)}
          onSubmit={(body, imageFile) =>
            editing === 'new'
              ? api.createWarehouseAdvertisement(body, imageFile)
              : api.updateWarehouseAdvertisement(editing.id, body, imageFile)
          }
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
