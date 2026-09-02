import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 15;

function statusBadgeClass(status) {
  if (status === 'resolved') return 'status-delivered';
  if (status === 'closed') return 'status-cancelled';
  return 'status-pending';
}

// Section 3: the complaints filed against this warehouse. Read-only - the
// reply path is the admin's (there is no warehouse reply route on the
// backend). A warehouse can never see another warehouse's complaints: the
// backend scopes every query to the warehouse resolved from the JWT.
export function WarehouseComplaintsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const statusLabel = (status) => t(`complaints.status.${status}`);

  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseComplaints({ limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.complaints,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    [],
  );

  const { data: complaints, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeSync(
    [REALTIME_EVENTS.COMPLAINT_CREATED, REALTIME_EVENTS.COMPLAINT_UPDATED],
    () => reset(),
  );

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.complaints')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : complaints.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">&#128172;</div>
          <div className="wh-empty-state-title">{t('complaints.warehouse.noComplaints')}</div>
        </div>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('complaints.numberColumn')}</th>
                  <th>{t('complaints.pharmacyColumn')}</th>
                  <th>{t('complaints.contextColumn')}</th>
                  <th>{t('complaints.orderColumn')}</th>
                  <th>{t('complaints.subjectColumn')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('complaints.createdColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((complaint) => (
                  <tr
                    key={complaint.id}
                    onClick={() => navigate(`/warehouse/complaints/${complaint.id}`)}
                  >
                    <td>
                      <span className="wh-num wh-table-order-num">
                        {t('complaints.numberValue', { number: complaint.complaintNumber })}
                      </span>
                    </td>
                    <td>{withArFallback(complaint.pharmacy?.nameEn, complaint.pharmacy?.nameAr)}</td>
                    <td>
                      <span className="wh-reason-badge">{t(`complaints.context.${complaint.contextType}`)}</span>
                    </td>
                    <td className="wh-num">
                      {complaint.relatedOrderNumber ? `#${complaint.relatedOrderNumber}` : '—'}
                    </td>
                    <td>{complaint.subject}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(complaint.status)}`}>
                        {statusLabel(complaint.status)}
                      </span>
                    </td>
                    <td className="wh-num wh-table-date">
                      {new Date(complaint.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wh-table-hint">{t('complaints.warehouse.clickRowHint')}</p>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
    </div>
  );
}
