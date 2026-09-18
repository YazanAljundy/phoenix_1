// The pure state machine behind usePaginatedData, kept out of the hook so the
// exact race it has to guard against can be unit-tested without a DOM - this
// project's web suite has no hook/component renderer, same reason
// orderStatusFlow.js/offersFilters.js/accountsFilters.js exist as their own
// modules.
//
// `reset()` (a page-1 load) and `loadMore()` (a page-N append) can both be in
// flight from the same list - a filter changes while "load more" is still
// running, say. Only the request whose id still matches `state.requestId` is
// "current"; every other one's success/fail is a no-op, changes included.
//
// Both loading flags are set together on every `start`, describing exactly
// the run that just became current - never just "my own" flag. That's what
// keeps a superseded request from leaving the OTHER flag stuck at `true`
// forever: there is nothing left for it to clear later, because its own
// success/fail is fully ignored (the requestId no longer matches), and the
// newer request already set both flags correctly for itself the moment it
// started.
export const initialPaginatedDataState = {
  data: [],
  isLoading: true,
  isLoadingMore: false,
  hasMore: false,
  nextCursor: null,
  error: null,
  requestId: 0,
};

export function paginatedDataReducer(state, action) {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        requestId: action.requestId,
        isLoading: !action.append,
        isLoadingMore: action.append,
        error: null,
      };
    case 'success':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        data: action.append ? [...state.data, ...action.result.rows] : action.result.rows,
        hasMore: action.result.hasMore,
        nextCursor: action.result.nextCursor,
        isLoading: false,
        isLoadingMore: false,
      };
    case 'fail':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        error: action.error,
        isLoading: false,
        isLoadingMore: false,
      };
    default:
      return state;
  }
}
