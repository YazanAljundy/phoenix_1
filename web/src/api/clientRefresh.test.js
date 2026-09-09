import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getRefreshToken, getToken, setSession } from './client';

// The file transports (requestBlob / requestUpload / requestFormData) bypass
// request(), and originally bypassed its 401-refresh-retry with it. After the
// 24h access token expired, the first template download or catalog import
// therefore failed with "Download failed. Please try again." while every JSON
// screen recovered silently - the user was not signed out, just told the
// operation had failed, with nothing to act on.
//
// vitest runs in `environment: node` here (no jsdom), so localStorage,
// sessionStorage and fetch are stubbed by hand. client.js only touches storage
// from inside its functions, never at module scope, so importing it is safe.

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// Minimal stand-in for the parts of Response these transports read.
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => {
      throw new Error('not a blob response');
    },
  };
}

function blobResponse(contents) {
  return {
    ok: true,
    status: 200,
    json: async () => null,
    blob: async () => contents,
  };
}

const UNAUTHORIZED = () => jsonResponse(401, { message: 'Invalid or expired token.' });

describe('silent token refresh on the file transports', () => {
  let fetchMock;

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('FormData', class FakeFormData {
      constructor() {
        this.entries = [];
      }

      append(key, value) {
        this.entries.push([key, value]);
      }
    });

    setSession({ token: 'expired-access', refreshToken: 'valid-refresh' });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Replies 401 to the first call on a protected path, hands out a new pair on
  // /auth/refresh, then succeeds. `after` is what the replayed request returns.
  function stubExpiredThenRefreshed(after) {
    let protectedCalls = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonResponse(200, { token: 'fresh-access', refreshToken: 'rotated-refresh' });
      }
      protectedCalls += 1;
      return protectedCalls === 1 ? UNAUTHORIZED() : after;
    });
  }

  it('requestBlob renews and replays instead of failing the download', async () => {
    const file = { size: 1024 };
    stubExpiredThenRefreshed(blobResponse(file));

    const result = await api.downloadCatalogTemplate();

    expect(result).toBe(file);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 401, refresh, replay

    const [firstUrl] = fetchMock.mock.calls[0];
    const [refreshUrl] = fetchMock.mock.calls[1];
    const [replayUrl] = fetchMock.mock.calls[2];
    expect(String(firstUrl)).toContain('/admin/catalog/template');
    expect(String(refreshUrl)).toContain('/auth/refresh');
    expect(String(replayUrl)).toContain('/admin/catalog/template');

    // The replay carries the new token, not the stale one.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-access');

    // And the rotated pair was stored, so the next call starts from the new one.
    expect(getToken()).toBe('fresh-access');
    expect(getRefreshToken()).toBe('rotated-refresh');
  });

  it('requestUpload renews and replays', async () => {
    stubExpiredThenRefreshed(jsonResponse(200, { imported: 12 }));

    const result = await api.importCatalogExcel({ name: 'catalog.xlsx' });

    expect(result).toEqual({ imported: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requestFormData renews and replays', async () => {
    stubExpiredThenRefreshed(jsonResponse(201, { id: 'banner-1' }));

    const result = await api.createAdminBanner(new FormData());

    expect(result).toEqual({ id: 'banner-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after one replay rather than looping', async () => {
    // A token that is rejected even when freshly minted must not retry forever.
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('/auth/refresh')
        ? jsonResponse(200, { token: 'fresh-access', refreshToken: 'rotated-refresh' })
        : UNAUTHORIZED()
    );

    await expect(api.downloadCatalogTemplate()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 401, refresh, replay - then stop
  });

  it('surfaces the original 401 when there is no refresh token to spend', async () => {
    setSession({ token: 'expired-access' });
    fetchMock.mockImplementation(async () => UNAUTHORIZED());

    await expect(api.downloadCatalogTemplate()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no pointless refresh attempt
  });

  it('a failed refresh does not turn a download error into a logout', async () => {
    // The refresh itself is rejected (revoked session, or the server is down).
    // The caller still gets its 401, and nothing here clears stored tokens -
    // that decision belongs to AuthContext, which distinguishes the two.
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('/auth/refresh') ? jsonResponse(401, null) : UNAUTHORIZED()
    );

    await expect(api.downloadCatalogTemplate()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 401, failed refresh, no replay
  });

  it('a download and a page load expiring together refresh only once', async () => {
    // All four transports share the same single-flight promise, so concurrent
    // 401s must not each spend a refresh token - the backend rotates them, so
    // the second spend would fail and sign the operator out.
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse(200, { token: 'fresh-access', refreshToken: 'rotated-refresh' });
      }
      if (getToken() !== 'fresh-access') return UNAUTHORIZED();
      // The download path reads .blob(), the JSON path reads .json().
      return String(url).includes('/template')
        ? blobResponse({ size: 1 })
        : jsonResponse(200, { accounts: [] });
    });

    await Promise.all([api.downloadCatalogTemplate(), api.adminAccounts()]);

    expect(refreshCalls).toBe(1);
  });
});
