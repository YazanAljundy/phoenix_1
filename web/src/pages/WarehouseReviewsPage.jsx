import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { StarRating } from '../components/StarRating';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';

const PAGE_SIZE = 15;

// Section 8/13c: reviews pharmacies left about THIS warehouse - only ones
// isVisible has already flipped true for (the one-month gate + its cron job
// are a separate, not-yet-built piece; this screen just reads whatever the
// backend currently exposes).
export function WarehouseReviewsPage() {
  const { t } = useTranslation();
  // averageRating/totalCount/distribution reflect EVERY visible review (the
  // backend computes them independently of pagination) - only the row list
  // itself grows page by page via "Load more".
  const [averageRating, setAverageRating] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [distributionByStar, setDistributionByStar] = useState({});

  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseReviews({ limit: PAGE_SIZE, after: cursor }).then((data) => {
        setAverageRating(data.averageRating);
        setTotalCount(data.totalCount);
        setDistributionByStar(data.distribution);
        return {
          rows: data.reviews,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        };
      }),
    []
  );

  const { data: reviews, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: distributionByStar[star] ?? 0,
  }));
  const maxCount = Math.max(1, ...distribution.map((d) => d.count));

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.reviews')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : reviews.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">★</div>
          <div className="wh-empty-state-title">{t('reviews.noReviews')}</div>
        </div>
      ) : (
        <>
          <div className="wh-review-summary-card">
            <div className="wh-review-score">
              <div className="wh-review-score-value wh-num">{averageRating.toFixed(1)}</div>
              <StarRating value={Math.round(averageRating)} size={20} />
              <div className="wh-review-score-count">
                {t('reviews.summary', { rating: averageRating.toFixed(1), count: totalCount })}
              </div>
            </div>
            <div className="wh-review-bars">
              {distribution.map(({ star, count }) => (
                <div className="wh-review-bar-row" key={star}>
                  <span className="wh-review-bar-label wh-num">{star}★</span>
                  <span className="wh-review-bar-track">
                    <span className="wh-review-bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </span>
                  <span className="wh-review-bar-count wh-num">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="wh-card" style={{ overflow: 'hidden' }}>
            <div className="wh-review-list-head">{t('reviews.latest')}</div>
            {reviews.map((review) => {
              const reviewerName = review.reviewerName?.trim() || t('reviews.anonymousReviewer');
              return (
                <div className="wh-review-row" key={review.id}>
                  <div className="wh-review-avatar">{reviewerName.charAt(0)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="wh-review-row-head">
                      <span className="wh-review-row-name">{reviewerName}</span>
                      <StarRating value={review.rating} size={14} />
                      <span className="wh-review-row-date wh-num">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {review.comment && <div className="wh-review-row-comment">&ldquo;{review.comment}&rdquo;</div>}
                    <div className="wh-review-row-order wh-num">
                      {t('reviews.orderNumber', { number: review.orderNumber })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
