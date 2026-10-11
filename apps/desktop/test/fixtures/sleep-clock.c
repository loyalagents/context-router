#include <time.h>
#include <mach/mach_time.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

// Linked only into test executables compiled with clock_gettime renamed.
// No injected clock, environment switch or marker reader ships in the app.
int CRFixtureClockGettime(clockid_t clock, struct timespec *result) {
  if (clock != CLOCK_MONOTONIC && clock != CLOCK_UPTIME_RAW) { errno = EINVAL; return -1; }
  mach_timebase_info_data_t scale;
  if (mach_timebase_info(&scale) != KERN_SUCCESS) return -1;
  uint64_t nanos = (uint64_t)((long double)mach_absolute_time() * scale.numer / scale.denom);
  char mode = 0;
  int fd = open(CR_CLOCK_MARKER, O_RDONLY);
  if (fd >= 0) { if (read(fd, &mode, 1) != 1) mode = 0; close(fd); }
  // 's': an hour asleep, no awake time lost. 'a': an hour actually elapsed awake.
  if (mode == 'a' || (mode == 's' && clock == CLOCK_MONOTONIC)) nanos += 3600ULL * 1000000000ULL;
  result->tv_sec = nanos / 1000000000ULL;
  result->tv_nsec = nanos % 1000000000ULL;
  return 0;
}
