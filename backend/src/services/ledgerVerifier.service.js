const { verifyAllAccounts } = require('./ledger.service');

// Money-Flow V2. The scheduled proof that LedgerAccount.balanceCache still
// equals a full replay of the account's entries.
//
// The cache is moved incrementally inside each posting transaction, so under
// correct operation it can never drift. A mismatch therefore always means a
// bug (or a write that bypassed ledger.service.js) - it is logged loudly, not
// swallowed, and the account is rebuilt so users see the right number while
// the cause is investigated.

const DAILY_MS = 24 * 60 * 60 * 1000;
const VERIFY_HOUR = 3; // 03:00 server-local, well outside business hours

let timer = null;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date();
  next.setHours(VERIFY_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return { delayMs: next.getTime() - now.getTime(), next };
}

async function runVerification() {
  try {
    const mismatches = await verifyAllAccounts({ rebuild: true });
    if (mismatches.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[ledger] balance verification passed for every account.');
      return mismatches;
    }
    // eslint-disable-next-line no-console
    console.error(
      `[ledger] *** ${mismatches.length} account(s) had a stale balance cache and were rebuilt.`
    );
    for (const mismatch of mismatches) {
      // eslint-disable-next-line no-console
      console.error(
        `[ledger]     account=${mismatch.accountId} cached=${JSON.stringify(
          mismatch.cached
        )} replay=${JSON.stringify(mismatch.replay)}`
      );
    }
    return mismatches;
  } catch (err) {
    // A verification failure must never take the process down - it is a
    // read-only health check, not part of any request path.
    // eslint-disable-next-line no-console
    console.error('[ledger] balance verification failed to run.', err.message);
    return [];
  }
}

// Same "setTimeout to the first fixed clock time, then a plain 24h interval"
// shape exchangeRate.service.js already uses for its daily refresh - no cron
// dependency for a single daily job.
function startLedgerVerifier() {
  if (timer) return;
  const { delayMs, next } = msUntilNextRun();
  // eslint-disable-next-line no-console
  console.log(`[ledger] balance verification scheduled for 03:00 on ${next.toDateString()}.`);

  timer = setTimeout(() => {
    runVerification();
    timer = setInterval(runVerification, DAILY_MS);
  }, delayMs);
  // Never hold the process open just for the verifier.
  if (typeof timer.unref === 'function') timer.unref();
}

function stopLedgerVerifier() {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}

module.exports = { startLedgerVerifier, stopLedgerVerifier, runVerification };
