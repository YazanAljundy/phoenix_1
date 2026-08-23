import { useTranslation } from 'react-i18next';

// Shared "Load more" footer for every cursor-paginated list (warehouse and
// admin panels alike) - a plain button while there's another page, a small
// spinner label while it's in flight, and a static line once the list is
// exhausted. Rendered by the page itself only inside its "has items" branch
// - this never handles the zero-results empty state.
export function LoadMoreControl({ hasMore, isLoadingMore, onLoadMore, pageSize }) {
  const { t } = useTranslation();

  if (!hasMore) {
    return <p className="load-more-done">{t('common.allResultsShown')}</p>;
  }

  return (
    <button className="btn-secondary load-more-btn" disabled={isLoadingMore} onClick={onLoadMore}>
      {isLoadingMore ? (
        <>
          <span className="load-more-spinner" />
          {t('common.loadingMore')}
        </>
      ) : (
        t('common.loadMore', { count: pageSize })
      )}
    </button>
  );
}
