const STARS = [1, 2, 3, 4, 5];

// Read-only when onChange is omitted (review display); interactive when
// provided (the rate-pharmacy form) - one component instead of two so the
// visual doesn't drift between "show a rating" and "pick a rating".
export function StarRating({ value, onChange, size = 20 }) {
  const interactive = typeof onChange === 'function';

  return (
    <div className="star-rating">
      {STARS.map((star) => (
        <span
          key={star}
          className={`star ${star <= value ? 'star-filled' : 'star-empty'}`}
          style={{ fontSize: size, cursor: interactive ? 'pointer' : 'default' }}
          onClick={interactive ? () => onChange(star) : undefined}
          role={interactive ? 'button' : undefined}
          aria-label={interactive ? `Rate ${star} star${star > 1 ? 's' : ''}` : undefined}
        >
          ★
        </span>
      ))}
    </div>
  );
}
