#import <Foundation/Foundation.h>
#import "package.h"
#import "supervisor.h"
#import "maintenance.h"
#import "menu.h"
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* All holders retain the same open-file description. Never call LOCK_UN. */
static int verifyInherited(void) {
  struct stat s;
  if (fstat(3, &s) || !S_ISREG(s.st_mode) || s.st_uid != getuid() ||
      (s.st_mode & 07777) != 0600 || s.st_nlink != 1 ||
      flock(3, LOCK_EX | LOCK_NB)) return 1;
  char boot[65] = {0}; size_t size = sizeof(boot);
  if (sysctlbyname("kern.bootsessionuuid", boot, &size, NULL, 0) || size < 2 || size > sizeof(boot)) return 1;
  for (size_t i = 0; boot[i]; i++)
    if (!((boot[i] >= 'a' && boot[i] <= 'z') || (boot[i] >= 'A' && boot[i] <= 'Z') ||
          (boot[i] >= '0' && boot[i] <= '9') || boot[i] == '-')) return 1;
  return printf("%s\n", boot) < 0 ? 1 : 0;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && !strcmp(argv[1], "verify-inherited")) return verifyInherited();
    @try {
      if(argc==1||(argc==4&&!strcmp(argv[1],"menu")&&!strcmp(argv[2],"--root"))){NSString *bundle=CRBundleRoot();(void)CRVerifyPackage(bundle);return CRRunMenu(bundle,argc==1?nil:[NSString stringWithUTF8String:argv[3]]);}
      if (argc == 8 && !strcmp(argv[1], "guardian") && !strcmp(argv[2], "--root") && !strcmp(argv[4], "--ui-port") && !strcmp(argv[6], "--mcp-port")) {
        NSString *ui=[NSString stringWithUTF8String:argv[5]], *mcp=[NSString stringWithUTF8String:argv[7]];
        if(!CRPattern(ui,@"0|[1-9][0-9]{0,4}")||!CRPattern(mcp,@"0|[1-9][0-9]{0,4}")||ui.integerValue>65535||mcp.integerValue>65535|| (ui.integerValue&&ui.integerValue==mcp.integerValue))CRFail();
        NSString *bundle=CRBundleRoot(); (void)CRVerifyPackage(bundle);
        return CRRunGuardian(bundle,[NSString stringWithUTF8String:argv[3]],ui.integerValue,mcp.integerValue);
      }
      if (argc == 2 && !strcmp(argv[1], "verify-package")) {
        NSDictionary *m = CRVerifyPackage(CRBundleRoot());
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"version": @1, @"distribution": m[@"distribution"], @"source": m[@"source"], @"securityEpoch": m[@"securityEpoch"]} options:0 error:nil];
        if (fwrite(data.bytes, 1, data.length, stdout) != data.length || putchar('\n') == EOF) CRFail();
        return 0;
      }
      if(argc>1){
        if(argc==2&&!strcmp(argv[1],"--help")){puts("Context Router private Mac pilot\nQuit the app before maintenance.\n[--root /canonical/private/managed-v1] [--pending-store ID] mcp <list|provision|rotate|revoke|permissions|grant|upgrade> [arguments]\nidentity <rotate|recover-initialize|recover-rotation|recover-database-bootstrap>\ninspect CLIENT_ID | backup | restore --from /canonical/private/backup\nactivate-restore STORE_ID --acknowledge-restored-authority | abandon-restore STORE_ID\nresume-setup | initialize-recovered");return 0;}
        NSString *bundle=CRBundleRoot();(void)CRVerifyPackage(bundle);NSMutableArray *arguments=[NSMutableArray array];for(int i=1;i<argc;i++){NSString *value=[NSString stringWithUTF8String:argv[i]];if(!value)CRFail();[arguments addObject:value];}return CRRunMaintenance(bundle,arguments);
      }
    } @catch (NSException *exception) { (void)exception; }
    fputs("Managed command unavailable\n", stderr);
    return 1;
  }
}
