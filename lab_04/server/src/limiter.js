/** Token bucket: `perSecond` tokens refill continuously, `burst` is the bucket size. */
export function createRateLimiter({ perSecond, burst = perSecond, now = () => performance.now() }) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
