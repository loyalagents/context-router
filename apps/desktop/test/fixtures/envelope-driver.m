#import "envelope.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
int main(int argc, const char *argv[]) {
  @autoreleasepool { @try {
    if (argc != 3) CRFail();
    NSString *command = [NSString stringWithUTF8String:argv[1]];
    CREnvelope *owner = [[CREnvelope alloc] initWithRoot:[NSString stringWithUTF8String:argv[2]] allowFresh:[@[@"fresh", @"survivor"] containsObject:command]];
    if([command hasPrefix:@"metadata-"]){
      id pending=owner.installation[@"pendingRestore"];
      NSString *operation=[command isEqual:@"metadata-activate"]?@"activate-restore":@"abandon-restore";
      [owner beginMetadataOperation:operation pendingStore:pending[@"storeId"] expectedSelection:owner.installation[@"selectedStore"]];
      fputs("{\"nativeOnly\":true}\n",stdout);fflush(stdout);char c;while(read(0,&c,1)>0){}[owner finishOutcome:@"ok"];return 0;
    }
    NSString *role = [command hasPrefix:@"recover-"] || [command isEqual:@"admin"] ? @"maintenance" : @"prepare";
    NSString *operation = [@[@"fresh", @"survivor"] containsObject:command] ? @"initialize" : [command isEqual:@"existing"] ? @"resume-setup" : command;
    NSDictionary *cap = [owner beginRole:role operation:operation store:owner.installation[@"selectedStore"]];
    NSData *bytes = [NSJSONSerialization dataWithJSONObject:cap options:0 error:nil];
    fwrite(bytes.bytes, 1, bytes.length, stdout); putchar('\n'); fflush(stdout);
    char c; while (read(0, &c, 1) > 0) {}
    if ([command isEqual:@"survivor"]) {
      int hold[2]; if (pipe(hold)) CRFail(); pid_t pid = fork(); if (pid < 0) CRFail();
      if (!pid) { close(hold[1]); while (read(hold[0], &c, 1) > 0) {} _exit(0); }
      close(hold[0]); int denied = 0;
      @try { [owner finishOutcome:@"ok"]; } @catch (NSException *e) { (void)e; }
      @try { [owner assertHeld]; } @catch (NSException *e) { (void)e; denied++; }
      @try { [owner beginRole:@"prepare" operation:@"resume-setup" store:owner.installation[@"selectedStore"]]; } @catch (NSException *e) { (void)e; denied++; }
      @try { [owner publishInstallation:owner.installation]; } @catch (NSException *e) { (void)e; denied++; }
      @try { [owner finishOutcome:@"ok"]; } @catch (NSException *e) { (void)e; denied++; }
      close(hold[1]); int status; if (waitpid(pid, &status, 0) != pid || status) CRFail();
      printf("{\"denied\":%d}\n", denied); return denied == 4 ? 0 : 2;
    }
    [owner finishOutcome:@"ok"]; return 0;
  } @catch (NSException *exception) { (void)exception; fputs("fixture-refused\n", stderr); return 1; } }
}
