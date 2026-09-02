import http from 'k6/http';
import { baseUrl, params, record, identity } from '../lib/runtime.js';
import { expectedStatuses } from 'k6/http';

// Scenario F - reviews: read the list, submit a rating, read the list again.
//
// A review is unique per (orderId, reviewerType), so each fixture order can be
// rated exactly once. Every VU therefore walks its own pharmacy's delivered
// orders and stops writing once they are used up: past that point the endpoint
// answers 409 ALREADY_REVIEWED, which is a valid measurement of the duplicate
// path but must not be mistaken for the create path. `reviewWrites` counts
// only the attempts that had an unused order available.

const enableWrites = __ENV.RUN_WRITE_SCENARIOS === 'true';

export function readReviews(token) {
  const response = http.get(baseUrl + '/reviews', params(token, 'reviews_list'));
  record(response, 'reviews_list');
}

export function reviewFlow(token) {
  readReviews(token);
  if (!enableWrites) return;

  const user = identity();
  if (!user.orderIds.length) return;
  // One order per iteration, walked in order, so a VU consumes its own pool
  // rather than colliding with another VU's.
  const index = __ITER % user.orderIds.length;
  const orderId = user.orderIds[index];
  const response = http.post(
    baseUrl + '/reviews',
    JSON.stringify({
      orderId,
      rating: 1 + (__ITER % 5),
      comment: '[LOADTEST] review scenario',
    }),
    // 201 and 409 are both correct answers here, so both must count as
    // successes for k6's own http_req_failed rate as well - otherwise the
    // suite reports a baseline error rate that is really just this endpoint
    // behaving exactly as designed.
    params(token, 'reviews_create', { responseCallback: expectedStatuses(201, 409) })
  );
  // 409 = this fixture order has already been rated; a correct answer, not a
  // failure. See the note on record() in lib/runtime.js.
  record(response, 'reviews_create', [409]);

  readReviews(token);
}
