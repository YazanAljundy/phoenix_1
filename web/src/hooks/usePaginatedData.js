import { useCallback, useReducer, useRef } from 'react';
import { initialPaginatedDataState, paginatedDataReducer } from './usePaginatedDataReducer';

// Shared cursor-pagination hook for every "Load more" list in the admin and
// warehouse panels (mirrors the cursor/hasMore/nextCursor shape the backend
// already returns - see backend/src/utils/pagination.js). `fetchPage` is
// supplied by the caller and must resolve to `{ rows, hasMore, nextCursor }`;
// this hook only ever accumulates/resets those, it doesn't know the shape of
// any particular endpoint's raw response.
//
// Deliberately doesn't fetch on its own - the calling page always owns one
// `useEffect(() => reset(), [...filterDeps])`, which both loads the first
// batch on mount AND re-fetches page one whenever a filter/search value
// changes (Sections 5+6 of the pagination spec), with a single code path
// instead of special-casing "is this the first render".
export function usePaginatedData(fetchPage) {
  const [state, dispatch] = useReducer(paginatedDataReducer, initialPaginatedDataState);
  const { data, isLoading, isLoadingMore, hasMore, nextCursor, error } = state;

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  // Guards against a slow page-1 response landing after a later reset/
  // loadMore already resolved (e.g. the user switches filters twice fast) -
  // only the most recent request is allowed to commit its result. See
  // usePaginatedDataReducer.js for why both loading flags are set on every
  // `start` rather than just the one this call owns.
  const requestIdRef = useRef(0);

  const run = useCallback(async (cursor, append) => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'start', requestId, append });
    try {
      const result = await fetchPageRef.current(cursor);
      dispatch({ type: 'success', requestId, append, result });
    } catch (err) {
      dispatch({ type: 'fail', requestId, append, error: err.message });
    }
  }, []);

  const reset = useCallback(() => run(null, false), [run]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    run(nextCursor, true);
  }, [hasMore, isLoadingMore, nextCursor, run]);

  return { data, isLoading, isLoadingMore, hasMore, error, loadMore, reset };
}
