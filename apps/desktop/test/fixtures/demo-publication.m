// Test-only syscall faults; the shipped native sources expose no fault controls.
#import "envelope.h"
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
static NSString *faultRoot, *faultKind;
static BOOL renamedInstallation;
static unsigned injected;
static int fixtureRename(const char *, const char *);
static int fixtureSync(int);
#define rename fixtureRename
#define fsync fixtureSync
#import "../../native/envelope.m"
#undef rename
#undef fsync
static int fixtureRename(const char *from, const char *to) {
  BOOL target = faultRoot && [[NSString stringWithUTF8String:to] isEqual:[faultRoot stringByAppendingPathComponent:@"installation.json"]];
  if (target && [faultKind isEqual:@"before-rename"]) { injected++; errno = EIO; return -1; }
  int result = rename(from, to);
  if (target && !result) renamedInstallation = YES;
  return result;
}
static int fixtureSync(int fd) {
  char file[PATH_MAX] = {0};
  if (renamedInstallation && [faultKind isEqual:@"directory-sync"] && !fcntl(fd, F_GETPATH, file) &&
      [[NSString stringWithUTF8String:file] isEqual:faultRoot]) { injected++; errno = EIO; return -1; }
  return fsync(fd);
}
static void copy(NSString *source, NSString *target) {
  if (![[NSFileManager defaultManager] copyItemAtPath:source toPath:target error:nil]) CRFail();
}
static void printJSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  if (!data || fwrite(data.bytes, 1, data.length, stdout) != data.length) CRFail();
  fputc('\n', stdout); fflush(stdout);
}
int main(int argc, char **argv) { @autoreleasepool {
  @try {
    if (argc < 3) CRFail();
    NSString *root = @(argv[1]), *action = @(argv[2]);
    CREnvelope *env = [[CREnvelope alloc] initWithRoot:root allowFresh:[action isEqual:@"reserve"]];
    if ([action isEqual:@"reserve"]) {
      if (argc != 5 || !env.fresh) CRFail();
      NSString *personal = env.installation[@"personalStore"], *pair = [[root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:personal];
      (void)[env beginRole:@"prepare" operation:@"initialize" store:personal];
      for (NSString *name in @[@"data", @"identity"]) copy([@(argv[3]) stringByAppendingPathComponent:name], [pair stringByAppendingPathComponent:name]);
      NSMutableDictionary *ready = [env.installation mutableCopy]; ready[@"setup"] = @"ready";
      [env publishInstallation:ready]; [env finishOutcome:@"ok"];
      (void)[env reserveDemoWithSeed:@"historical-2024-2025-v1" hash:@(argv[4])];
      printJSON(env.installation); return 0;
    }
    if ([action isEqual:@"admit"]) { if (argc != 3) CRFail(); printJSON(env.installation); return 0; }
    if (argc != 5 || ![@[@"before-rename", @"directory-sync", @"failed-terminal", @"success"] containsObject:action]) CRFail();
    NSString *store = env.installation[@"pendingDemo"][@"storeId"];
    NSDictionary *capability = [env beginRole:@"demo-prepare" operation:@"initialize" store:store];
    if (![capability[@"storeId"] isEqual:store] || ![capability[@"mode"] isEqual:@"demo"]) CRFail();
    // The real source seeder is already fully closed. This driver covers native
    // capability issuance/publication, not seeding through the managed bootstrap.
    NSString *pair = [[root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:store];
    NSString *evidence = [[root stringByAppendingPathComponent:@"demo"] stringByAppendingPathComponent:store];
    for (NSString *name in @[@"data", @"identity"]) copy([@(argv[3]) stringByAppendingPathComponent:name], [pair stringByAppendingPathComponent:name]);
    for (NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:@(argv[4]) error:nil]) {
      if ([name isEqual:@"exports"]) {
        for (NSString *token in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:[@(argv[4]) stringByAppendingPathComponent:name] error:nil])
          copy([[@(argv[4]) stringByAppendingPathComponent:name] stringByAppendingPathComponent:token], [[evidence stringByAppendingPathComponent:name] stringByAppendingPathComponent:token]);
      } else copy([@(argv[4]) stringByAppendingPathComponent:name], [evidence stringByAppendingPathComponent:name]);
    }
    [env finishOutcome:[action isEqual:@"failed-terminal"] ? @"failed" : @"ok"];
    faultRoot = root; faultKind = action;
    [env publishDemo];
    if (![action isEqual:@"success"]) CRFail();
    printJSON(@{@"refused":@NO, @"injected":@(injected)}); return 0;
  } @catch (NSException *exception) { (void)exception; printJSON(@{@"refused":@YES, @"injected":@(injected)}); return 1; }
} }
