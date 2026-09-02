import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

// resolved -> green, closed -> red/neutral, pending & in_review -> amber. The
// panel's status-badge only ships these three tones, so the two "open" states
// share the amber one.
function statusBadgeClass(status) {
  if (status === 'resolved') return 'status-delivered';
  if (status === 'closed') return 'status-cancelled';
  return 'status-pending';
}

const FILTERS = ['all', 'pending', 'in_review', 'resolved', 'closed'];

export function AdminComplaintsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');
  const [counts, setCounts] = useState({ all: 0, pending: 0, in_review: 0, resolved: 0, closed: 0 });

  const statusLabel = (status) => t(`complaints.status.${status}`);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .adminComplaints({
          status: activeFilter === 'all' ? undefined : activeFilter,
          limit: PAGE_SIZE,
          after: cursor,
        })
        .then((data) => {
          if (data.counts) setCounts(data.counts);
          return {
            rows: data.complaints,
            hasMore: data.pagination.hasMore,
            nextCursor: data.pagination.nextCursor,
          };
        }),
    [activeFilter],
  );

  const { data: complaints, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  // Realtime: a pharmacy filing a complaint, or another admin answering one,
  // both change this queue. `reset()` re-reads page one - and with it the
  // per-status counts the backend returns on every request.
  useRealtimeSync(
    [REALTIME_EVENTS.COMPLAINT_CREATED, REALTIME_EVENTS.COMPLAINT_UPDATED],
    () => reset(),
  );

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.complaints')}</h1>
        <div className="adm-page-head-meta">{t('complaints.admin.headHint')}</div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`adm-pill${activeFilter === filter ? ' active' : ''}`}
                onClick={() => setActiveFilter(filter)}
              >
                {filter === 'all' ? t('complaints.admin.filterAll') : statusLabel(filter)} ({counts[filter] ?? 0})
              </button>
            ))}
          </div>

          {complaints.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#128172;</div>
              <div className="adm-empty-state-title">{t('complaints.admin.noComplaints')}</div>
            </div>
          ) : (
            <>
              <div className="adm-card table-scroll">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>{t('complaints.numberColumn')}</th>
                      <th>{t('complaints.pharmacyColumn')}</th>
                      <th>{t('complaints.contextColumn')}</th>
                      <th>{t('complaints.warehouseColumn')}</th>
                      <th>{t('complaints.orderColumn')}</th>
                      <th>{t('complaints.subjectColumn')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('complaints.createdColumn')}</th>
                      <th>{t('complaints.updatedColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.map((complaint) => (
                      <tr
                        key={complaint.id}
                        onClick={() => navigate(`/admin/complaints/${complaint.id}`)}
                      >
                        <td>
                          <span className="adm-num">
                            {t('complaints.numberValue', { number: complaint.complaintNumber })}
                          </span>
                        </td>
                        <td>{withArFallback(complaint.pharmacy?.nameEn, complaint.pharmacy?.nameAr)}</td>
                        <td>
                          <span className="adm-tag">{t(`complaints.context.${complaint.contextType}`)}</span>
                        </td>
                        <td>
                          {complaint.warehouse
                            ? withArFallback(complaint.warehouse.nameEn, complaint.warehouse.nameAr)
                            : '—'}
                        </td>
                        <td className="adm-num">
                          {complaint.relatedOrderNumber ? `#${complaint.relatedOrderNumber}` : '—'}
                        </td>
                        <td>{complaint.subject}</td>
                        <td>
                          <span className={`status-badge ${statusBadgeClass(complaint.status)}`}>
                            {statusLabel(complaint.status)}
                          </span>
                        </td>
                        <td className="adm-num">
                          {new Date(complaint.createdAt).toLocaleDateString()}
                        </td>
                        <td className="adm-num">
                          {new Date(complaint.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="adm-table-hint">{t('complaints.admin.clickRowHint')}</p>
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
    </div>
  );
}
