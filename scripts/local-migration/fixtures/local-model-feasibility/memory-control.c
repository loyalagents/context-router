/* CP1 macOS-only read-only footprint probe. PID supplied from retained child handle. */
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <unistd.h>
#include <libproc.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
int main(int argc, char **argv) {
    char *end = NULL;
    long candidate = argc == 2 ? strtol(argv[1], &end, 10) : getpid();
    if (candidate <= 0 || candidate > INT_MAX || (end && *end)) return 2;
    struct rusage_info_v4 usage = {0};
    if (proc_pid_rusage((int)candidate, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) return 3;
    int pressure = 0; size_t size = sizeof(pressure);
    if (sysctlbyname("kern.memorystatus_vm_pressure_level", &pressure, &size, NULL, 0)) return 4;
    struct xsw_usage swap = {0}; size = sizeof(swap);
    if (sysctlbyname("vm.swapusage", &swap, &size, NULL, 0)) return 5;
    printf("{\"physicalFootprintBytes\":%llu,\"lifetimePeakPhysicalFootprintBytes\":%llu,\"residentBytes\":%llu,\"pressure\":%d,\"swapUsedBytes\":%llu}\n",
      usage.ri_phys_footprint, usage.ri_lifetime_max_phys_footprint, usage.ri_resident_size, pressure, swap.xsu_used);
    return 0;
}
