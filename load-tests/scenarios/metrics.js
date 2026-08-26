import { Counter, Trend } from 'k6/metrics';

export const http4xx = new Counter('http_4xx');
export const http5xx = new Counter('http_5xx');
export const endpointLatency = new Trend('endpoint_latency');

export function recordStatus(response, endpoint) {
  endpointLatency.add(response.timings.duration, { endpoint });
  if (response.status >= 400 && response.status < 500) http4xx.add(1);
  if (response.status >= 500) http5xx.add(1);
}
