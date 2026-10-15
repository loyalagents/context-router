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
#include <pwd.h>

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
// External demo helpers receive no managed lock, capability, control channel,
// database environment or Node injection. They are ordinary client processes.
static int runDemoHelper(NSString *bundle,int argc,const char *argv[]){
  NSString *resources=[bundle stringByAppendingPathComponent:@"Contents/Resources"],*node=[resources stringByAppendingPathComponent:@"bin/node"],*entry=[resources stringByAppendingPathComponent:@"desktop/runtime/demo.mjs"];
  char **args=calloc((size_t)argc+3,sizeof(char *));if(!args)CRFail();
  args[0]=strdup(node.fileSystemRepresentation);args[1]=strdup("--no-global-search-paths");args[2]=strdup(entry.fileSystemRepresentation);
  for(int i=2;i<argc;i++)args[i+1]=strdup(argv[i]);
  struct passwd *account=getpwuid(getuid());if(!account)CRFail();
  NSMutableDictionary *safe=[@{@"HOME":[NSString stringWithUTF8String:account->pw_dir],@"NODE_ENV":@"production",@"NEXT_TELEMETRY_DISABLED":@"1",@"DO_NOT_TRACK":@"1"} mutableCopy];
  for(NSString *key in @[@"PATH",@"LANG",@"TERM",@"COLORTERM"]){const char *value=getenv(key.UTF8String);if(value){NSString *text=[NSString stringWithUTF8String:value];if(!text||text.length>16384||[text rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)CRFail();safe[key]=text;}}
  for(int n=2;n+1<argc;n++)if(!strcmp(argv[n],"--auth")&&!strcmp(argv[n+1],"api-key")){
    const char *key=getenv("CR_DEMO_ANTHROPIC_API_KEY");if(key){NSString *value=[NSString stringWithUTF8String:key];if(!value||value.length>16384||[value rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)CRFail();safe[@"CR_DEMO_ANTHROPIC_API_KEY"]=value;}
  }
  char **environment=calloc(safe.count+1,sizeof(char *));if(!environment)CRFail();NSUInteger i=0;
  for(NSString *key in safe)environment[i++]=strdup([[NSString stringWithFormat:@"%@=%@",key,safe[key]] UTF8String]);
  for(int n=0;n<argc+1;n++)if(!args[n])CRFail();
  if(chdir(resources.fileSystemRepresentation))CRFail();for(int fd=3,maximum=getdtablesize();fd<maximum;fd++)close(fd);execve(args[0],args,environment);CRFail();return 1;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && !strcmp(argv[1], "verify-inherited")) return verifyInherited();
    @try {
      if(argc==1||!strcmp(argv[1],"menu")||!strcmp(argv[1],"guardian")){
        BOOL menu=argc==1||!strcmp(argv[1],"menu");
        NSMutableDictionary *options=[NSMutableDictionary dictionary];
        for(int i=2;i<argc;i+=2){
          if(i+1>=argc)CRFail();NSString *key=[NSString stringWithUTF8String:argv[i]],*value=[NSString stringWithUTF8String:argv[i+1]];
          if(![@[@"--root",@"--ui-port",@"--mcp-port",@"--demo-mcp-port"] containsObject:key]||options[key]||!value)CRFail();options[key]=value;
        }
        if(!menu&&!options[@"--root"])CRFail();
        NSString *ui=options[@"--ui-port"]?:@"0",*mcp=options[@"--mcp-port"]?:@"8787",*demo=options[@"--demo-mcp-port"]?:@"8790";
        NSMutableSet *ports=[NSMutableSet set];
        for(NSString *port in @[ui,mcp,demo]){
          if(!CRPattern(port,@"0|[1-9][0-9]{0,4}")||port.integerValue>65535||(port.integerValue&&[ports containsObject:port]))CRFail();
          if(port.integerValue)[ports addObject:port];
        }
        NSString *bundle=CRBundleRoot();(void)CRVerifyPackage(bundle);
        return menu?CRRunMenu(bundle,options[@"--root"],ui.integerValue,mcp.integerValue,demo.integerValue):CRRunGuardian(bundle,options[@"--root"],ui.integerValue,mcp.integerValue,demo.integerValue);
      }
      if (argc == 2 && !strcmp(argv[1], "verify-package")) {
        NSDictionary *m = CRVerifyPackage(CRBundleRoot());
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"version": @1, @"distribution": m[@"distribution"], @"source": m[@"source"], @"securityEpoch": m[@"securityEpoch"]} options:0 error:nil];
        if (fwrite(data.bytes, 1, data.length, stdout) != data.length || putchar('\n') == EOF) CRFail();
        return 0;
      }
      if(argc>1&&!strcmp(argv[1],"demo")){NSString *bundle=CRBundleRoot();(void)CRVerifyPackage(bundle);return runDemoHelper(bundle,argc,argv);}
      if(argc>1){
        if(argc==2&&!strcmp(argv[1],"--help")){puts("Context Router private Mac pilot\nmenu [--root /canonical/private/managed-v1] [--ui-port 0] [--mcp-port 8787] [--demo-mcp-port 8790]\ndemo --root ROOT --store ID --generation ID --endpoint URL <status|verify|client inspect|login A|launch A|login B|launch B|desktop prepare|desktop apply> [--client codex|claude] [--auth subscription|api-key] [--executable PATH] [--config PATH] [--proposal PATH --proposal-sha256 SHA256 --desktop-closed]\nUse native actions or copy current commands from CR > Demo setup. Quit before offline verify or maintenance.\n[--root /canonical/private/managed-v1] [--mode personal|demo] [--pending-store ID] mcp <list|provision|rotate|revoke|permissions|grant|upgrade> [arguments]\nidentity <rotate|recover-initialize|recover-rotation|recover-database-bootstrap>\ninspect CLIENT_ID | backup | restore --from /canonical/private/backup\nactivate-restore STORE_ID --acknowledge-restored-authority | abandon-restore STORE_ID\nresume-setup | initialize-recovered | cleanup-downloads");return 0;}
        NSString *bundle=CRBundleRoot();(void)CRVerifyPackage(bundle);NSMutableArray *arguments=[NSMutableArray array];for(int i=1;i<argc;i++){NSString *value=[NSString stringWithUTF8String:argv[i]];if(!value)CRFail();[arguments addObject:value];}return CRRunMaintenance(bundle,arguments);
      }
    } @catch (NSException *exception) { (void)exception; }
    fputs("Managed command unavailable\n", stderr);
    return 1;
  }
}
