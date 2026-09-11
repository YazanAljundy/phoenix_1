// Does this failure mean the stored session is genuinely dead?
//
// Pulled out of AuthContext as a plain function for two reasons. It is the
// one decision in the panel that can destroy a working session, so it should
// be readable on its own; and this project's vitest runs in `environment:
// node` with no jsdom, so a pure function is the only part of that flow that
// can actually be tested.
//
// The bug this replaces (audit F-04) was a `.catch()` that took no argument
// at all, so a 500 from a restarting backend, a dropped Wi-Fi frame and a
// genuinely expired token were indistinguishable - every one of them wiped
// the token and bounced the operator to the login screen. That is at its
// worst during an incident, which is exactly when the panel is needed.
//
// Only the server explicitly rejecting the credential counts:
//
//   401 / 403        the token is expired, revoked, or the account is blocked
//   500 / 502 / 503  the server is unwell; the token is very likely still fine
//   no status        fetch() rejects with a bare TypeError when it cannot
//                    reach the host at all, and that carries no `status` -
//                    which is why this must read the property rather than
//                    assume every rejection is an HTTP response
//
// Anything that is not a clear rejection keeps the session.
export function shouldClearSession(error) {
  const status = error?.status;
  return status === 401 || status === 403;
}
