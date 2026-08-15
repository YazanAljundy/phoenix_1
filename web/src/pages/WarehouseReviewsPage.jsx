import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { StarRating } from '../components/StarRating';

// Section 8/13c: reviews pharmacies left about THIS warehouse - only ones
// isVisible has already flipped true for (the one-month gate + its cron job
// are a separate, not-yet-built piece; this screen just reads whatever the
// backend currently exposes).
export function WarehouseReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseReviews();
      setReviews(data.reviews);
      setAverageRating(data.averageRating);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : reviews.length === 0 ? (
        <p className="hint">No reviews yet.</p>
      ) : (
        <>
          <div className="review-summary">
            <StarRating value={Math.round(averageRating)} size={24} />
            <span className="review-summary-text">
              {averageRating.toFixed(1)} average &middot; {reviews.length}{' '}
              {reviews.length === 1 ? 'review' : 'reviews'}
            </span>
          </div>

          <div className="order-list">
            {reviews.map((review) => (
              <div className="order-card" key={review.id}>
                <div className="order-card-header">
                  <div>
                    <h2>{review.pharmacyNameEn}</h2>
                    <p>Order #{review.orderNumber}</p>
                  </div>
                  <StarRating value={review.rating} />
                </div>
                {review.comment && <p className="order-notes">&ldquo;{review.comment}&rdquo;</p>}
                <p className="order-notes">{new Date(review.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
