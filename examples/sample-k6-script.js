import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 3, duration: '10s' };
export default function () {
  const res = http.get('http://demo');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.5);
}
