import { describe, expect, it } from 'vitest';
import { initialPaginatedDataState, paginatedDataReducer } from './usePaginatedDataReducer';

const page = (rows, hasMore = false, nextCursor = null) => ({ rows, hasMore, nextCursor });

describe('paginatedDataReducer', () => {
  it('a page-1 start (reset) raises isLoading, not isLoadingMore', () => {
    const state = paginatedDataReducer(initialPaginatedDataState, {
      type: 'start',
      requestId: 1,
      append: false,
    });
    expect(state.isLoading).toBe(true);
    expect(state.isLoadingMore).toBe(false);
  });

  it('an append start (loadMore) raises isLoadingMore, not isLoading', () => {
    const seeded = { ...initialPaginatedDataState, isLoading: false };
    const state = paginatedDataReducer(seeded, { type: 'start', requestId: 1, append: true });
    expect(state.isLoadingMore).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('a matching success replaces data on reset and appends on loadMore', () => {
    const started = paginatedDataReducer(initialPaginatedDataState, {
      type: 'start',
      requestId: 1,
      append: false,
    });
    const loaded = paginatedDataReducer(started, {
      type: 'success',
      requestId: 1,
      append: false,
      result: page(['a', 'b'], true, 'c2'),
    });
    expect(loaded).toMatchObject({
      data: ['a', 'b'],
      hasMore: true,
      nextCursor: 'c2',
      isLoading: false,
      isLoadingMore: false,
    });

    const appending = paginatedDataReducer(loaded, {
      type: 'start',
      requestId: 2,
      append: true,
    });
    const appended = paginatedDataReducer(appending, {
      type: 'success',
      requestId: 2,
      append: true,
      result: page(['c'], false, null),
    });
    expect(appended).toMatchObject({
      data: ['a', 'b', 'c'],
      hasMore: false,
      nextCursor: null,
      isLoading: false,
      isLoadingMore: false,
    });
  });

  it('a matching fail records the message and clears its own loading flag', () => {
    const started = paginatedDataReducer(initialPaginatedDataState, {
      type: 'start',
      requestId: 1,
      append: false,
    });
    const failed = paginatedDataReducer(started, {
      type: 'fail',
      requestId: 1,
      append: false,
      error: 'network down',
    });
    expect(failed.error).toBe('network down');
    expect(failed.isLoading).toBe(false);
  });

  // The bug this closes: reset() firing while loadMore() is still in flight
  // used to leave isLoadingMore stuck true forever, because the stale
  // loadMore's own finally block was skipped (its requestId no longer
  // matched) and nothing else ever cleared the flag - which then made every
  // future loadMore() a permanent no-op via its own `isLoadingMore` guard.
  it('a loadMore superseded by a reset does not leave isLoadingMore stuck on success', () => {
    const ready = { ...initialPaginatedDataState, isLoading: false, hasMore: true, data: ['a'] };
    const loadMoreStarted = paginatedDataReducer(ready, {
      type: 'start',
      requestId: 1,
      append: true,
    });
    expect(loadMoreStarted.isLoadingMore).toBe(true);

    // The filter changes before that loadMore resolves: reset() supersedes it.
    const resetStarted = paginatedDataReducer(loadMoreStarted, {
      type: 'start',
      requestId: 2,
      append: false,
    });
    expect(resetStarted.isLoading).toBe(true);
    expect(resetStarted.isLoadingMore).toBe(false);

    // The superseded loadMore's fetch now resolves. It must change nothing -
    // flags included - since request 2 is already current.
    const afterStaleSuccess = paginatedDataReducer(resetStarted, {
      type: 'success',
      requestId: 1,
      append: true,
      result: page(['b'], true, 'c9'),
    });
    expect(afterStaleSuccess).toEqual(resetStarted);
    expect(afterStaleSuccess.isLoadingMore).toBe(false);
  });

  it('a loadMore superseded by a reset does not leave isLoadingMore stuck on failure either', () => {
    const ready = { ...initialPaginatedDataState, isLoading: false, hasMore: true, data: ['a'] };
    const loadMoreStarted = paginatedDataReducer(ready, {
      type: 'start',
      requestId: 1,
      append: true,
    });
    const resetStarted = paginatedDataReducer(loadMoreStarted, {
      type: 'start',
      requestId: 2,
      append: false,
    });

    const afterStaleFail = paginatedDataReducer(resetStarted, {
      type: 'fail',
      requestId: 1,
      append: true,
      error: 'timed out',
    });
    expect(afterStaleFail).toEqual(resetStarted);
    expect(afterStaleFail.isLoadingMore).toBe(false);
    expect(afterStaleFail.error).toBe(null);
  });

  // The symmetric direction: a reset (page 1) superseded by a loadMore must
  // not leave isLoading stuck on forever either - same root cause, same fix.
  it('a reset superseded by a loadMore does not leave isLoading stuck', () => {
    const midFilterChange = { ...initialPaginatedDataState, hasMore: true, data: ['a'] };
    const resetStarted = paginatedDataReducer(midFilterChange, {
      type: 'start',
      requestId: 1,
      append: false,
    });
    expect(resetStarted.isLoading).toBe(true);

    const loadMoreStarted = paginatedDataReducer(resetStarted, {
      type: 'start',
      requestId: 2,
      append: true,
    });
    expect(loadMoreStarted.isLoading).toBe(false);
    expect(loadMoreStarted.isLoadingMore).toBe(true);

    const afterStaleReset = paginatedDataReducer(loadMoreStarted, {
      type: 'success',
      requestId: 1,
      append: false,
      result: page(['stale'], false, null),
    });
    expect(afterStaleReset).toEqual(loadMoreStarted);
    expect(afterStaleReset.isLoading).toBe(false);
    // The stale page-1 result must not clobber the data a newer run owns.
    expect(afterStaleReset.data).toEqual(['a']);
  });

  it('an unknown action is a no-op', () => {
    const state = paginatedDataReducer(initialPaginatedDataState, { type: 'noop' });
    expect(state).toBe(initialPaginatedDataState);
  });
});
