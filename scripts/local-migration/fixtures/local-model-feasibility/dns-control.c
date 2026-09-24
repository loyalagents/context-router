/* CP1 macOS-only negative control. No product dependency. */
#include <stdio.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <netdb.h>
#include <unistd.h>
int main(void) {
    mach_port_t port = MACH_PORT_NULL;
    kern_return_t result = bootstrap_look_up(bootstrap_port, "com.apple.dnssd.service", &port);
    if (result == KERN_SUCCESS) mach_port_deallocate(mach_task_self(), port);
    char name[128];
    snprintf(name, sizeof(name), "step06-%d-does-not-exist.invalid", getpid());
    struct addrinfo *addresses = NULL;
    int lookup = getaddrinfo(name, NULL, NULL, &addresses);
    if (addresses) freeaddrinfo(addresses);
    printf("{\"machLookupResult\":%d,\"permissionDeniedCode\":%d,\"nativeLookupResult\":%d}\n", result, BOOTSTRAP_NOT_PRIVILEGED, lookup);
    return result == BOOTSTRAP_NOT_PRIVILEGED && lookup != 0 ? 0 : 1;
}
