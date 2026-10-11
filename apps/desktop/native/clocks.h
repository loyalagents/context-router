#import "package.h"
#include <time.h>

static inline double CRClockSeconds(clockid_t clock) {
  struct timespec value;
  if (clock_gettime(clock, &value)) CRFail();
  return value.tv_sec + value.tv_nsec / 1e9;
}

// Lifecycle budgets allow children time to run; system sleep cannot consume it.
static inline double CRLifecycleNow(void) { return CRClockSeconds(CLOCK_UPTIME_RAW); }

// Credentials keep expiring during sleep, matching the local server's TTL clock.
static inline double CRExpiryNow(void) { return CRClockSeconds(CLOCK_MONOTONIC); }
