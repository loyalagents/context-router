#import "maintenance.h"
#import "process.h"
#import "model-cleanup.h"
#include <pwd.h>
#include <sys/stat.h>
#include <signal.h>
#include <limits.h>
#include <unistd.h>
static volatile sig_atomic_t interrupted=0;
static void stopSignal(int number){(void)number;interrupted=1;}
NSString *CRDefaultRoot(BOOL create){
  struct passwd *user=getpwuid(getuid());char canonical[PATH_MAX];if(!user||!realpath(user->pw_dir,canonical))CRFail();
  NSString *parent=[[NSString stringWithUTF8String:canonical] stringByAppendingPathComponent:@"Library/Application Support/Context Router"];
  struct stat existing;if(lstat(parent.fileSystemRepresentation,&existing)){if(errno!=ENOENT||!create)CRFail();CRPrivateDirectory(parent,YES);}else CRPrivateDirectory(parent,NO);
  return [parent stringByAppendingPathComponent:@"managed-v1"];
}
static int runJob(NSString *bundle,CREnvelope *owner,NSString *role,NSString *operation,NSString *store,NSArray *arguments){
  NSDictionary *cap=[owner beginRole:role operation:operation store:store];BOOL prepare=[role isEqual:@"prepare"];
  NSString *resources=[bundle stringByAppendingPathComponent:@"Contents/Resources"],*entry=[resources stringByAppendingPathComponent:prepare?@"desktop/runtime/prepare-store.mjs":@"desktop/runtime/maintenance.mjs"];
  CRChild *child=nil;NSNumber *ack=nil;NSString *target=nil;BOOL stopping=NO,forced=NO,unsafe=NO;NSInteger stage=0;
  double deadline=CRNow()+([@[@"backup",@"restore"] containsObject:operation]?600:120);
  @try{
    child=[[CRChild alloc] initWithExecutable:[resources stringByAppendingPathComponent:@"bin/node"] arguments:[@[@"--no-global-search-paths",entry] arrayByAddingObjectsFromArray:arguments] directory:[resources stringByAppendingPathComponent:@"app"] lock:owner.lockFD capability:cap role:role];
    [child command:@"start" generation:owner.generation];
  }@catch(NSException *e){(void)e;if(!child){[owner finishOutcome:@"failed"];return 1;}unsafe=YES;stopping=YES;}
  while(YES){@autoreleasepool{
    @try{
      for(NSDictionary *record in [child pump]){
        if(ack||!CRInteger(record[@"version"],1,1)||![record[@"generation"] isEqual:owner.generation])CRFail();
        if(prepare){
          if([record[@"type"] isEqual:@"store-prepare-failed"]){
            if(!CRExact(record,@[@"version",@"generation",@"type",@"exitCode"])||!CRInteger(record[@"exitCode"],1,1))CRFail();ack=@1;
          }else{
            if(!CRExact(record,@[@"version",@"generation",@"type",@"targetId"])||![record[@"type"] isEqual:@"store-prepared"]||!CRPattern(record[@"targetId"],@"[A-Za-z0-9_-]{43}"))CRFail();target=record[@"targetId"];ack=@0;
          }
        }else{
          if(!CRExact(record,@[@"version",@"generation",@"type",@"exitCode"])||![record[@"type"] isEqual:@"maintenance-complete"]||!CRInteger(record[@"exitCode"],0,2))CRFail();ack=record[@"exitCode"];
        }
      }
      [owner assertHeld];if(child.protocolFailed||child.ownershipLost||(child.statusEnded&&!ack&&!child.exited)){unsafe=YES;stopping=YES;}
    }@catch(NSException *e){(void)e;unsafe=YES;stopping=YES;}
    if(child.exited){
      // exitCode is nonnegative only for WIFEXITED; a signal never matches an ack.
      BOOL certain=ack&&!forced&&!unsafe&&!child.protocolFailed&&!child.ownershipLost&&child.exitCode>=0&&child.exitCode==ack.intValue;
      [owner finishOutcome:certain?(child.success?@"ok":@"failed"):@"uncertain"];
      if(!certain)return 1;
      if(prepare&&child.success){
        NSString *pair=[[owner.root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:store];
        if(![CRReadJSON([pair stringByAppendingPathComponent:@"identity/identity.json"],16384,YES)[@"databaseTargetId"] isEqual:target])CRFail();
        NSMutableDictionary *value=[owner.installation mutableCopy];value[@"setup"]=@"ready";[owner publishInstallation:value];
      }
      return child.exitCode;
    }
    if(interrupted||CRNow()>=deadline)stopping=YES;
    if(stopping&&!stage){stage=1;deadline=CRNow()+15;if(!ack)@try{[child command:@"quit" generation:owner.generation];}@catch(NSException *e){(void)e;unsafe=YES;}}
    else if(stopping&&CRNow()>=deadline){
      if(stage>=3)return 1;forced=YES;@try{[child signal:stage==1?SIGTERM:SIGKILL];}@catch(NSException *e){(void)e;}stage++;deadline=CRNow()+5;
    }
    usleep(10000);
  }}
}
int CRRunMaintenance(NSString *bundle,NSArray<NSString *> *input){
  umask(0077);signal(SIGPIPE,SIG_IGN);signal(SIGTERM,stopSignal);signal(SIGINT,stopSignal);signal(SIGHUP,stopSignal);signal(SIGCHLD,SIG_DFL);
  NSMutableArray *args=[input mutableCopy];NSString *root=nil,*pendingID=nil;
  if(args.count>=2&&[args[0] isEqual:@"--root"]){root=args[1];[args removeObjectsInRange:NSMakeRange(0,2)];}
  if(args.count>=2&&[args[0] isEqual:@"--pending-store"]){pendingID=args[1];if(!CRPattern(pendingID,@"[a-f0-9]{32}"))CRFail();[args removeObjectsInRange:NSMakeRange(0,2)];}
  if(!args.count||args.count>128)CRFail();for(NSString *arg in args)if(arg.length>4096||[arg rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)CRFail();
  NSString *command=args[0];BOOL activate=[command isEqual:@"activate-restore"],abandon=[command isEqual:@"abandon-restore"],restore=[command isEqual:@"restore"],backup=[command isEqual:@"backup"],prepare=[@[@"resume-setup",@"initialize-recovered"] containsObject:command];
  if([command isEqual:@"cleanup-downloads"]){
    if(args.count!=1||pendingID)CRFail();CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root?:CRDefaultRoot(NO) allowFresh:NO];
    NSDictionary *plan=CRPlanModelCleanup(owner);[owner beginModelCleanup];CRApplyModelCleanup(owner,plan);[owner finishOutcome:@"ok"];
    puts("{\"status\":\"model-download-cleanup-complete\"}");return 0;
  }
  NSString *operation=@"admin";
  if(activate||abandon){if(pendingID||args.count!=(activate?3:2)||!CRPattern(args[1],@"[a-f0-9]{32}")||(activate&&![args[2] isEqual:@"--acknowledge-restored-authority"]))CRFail();pendingID=args[1];}
  else if(restore){if(pendingID||args.count!=3||![args[1] isEqual:@"--from"])CRFail();operation=@"restore";}
  else if(backup){if(pendingID||args.count!=1)CRFail();operation=@"backup";}
  else if(prepare){if(pendingID||args.count!=1)CRFail();operation=command;}
  else if([command isEqual:@"identity"]){
    if(args.count!=2||![@[@"rotate",@"recover-initialize",@"recover-rotation",@"recover-database-bootstrap"] containsObject:args[1]])CRFail();
    operation=[args[1] isEqual:@"recover-database-bootstrap"]?@"recover-bootstrap":[args[1] hasPrefix:@"recover-"]?@"recover-identity":@"admin";
    if(pendingID&&![operation isEqual:@"admin"])CRFail();
  }else if([command isEqual:@"mcp"]){if(args.count<2||![@[@"list",@"provision",@"rotate",@"revoke",@"permissions",@"grant",@"upgrade"] containsObject:args[1]])CRFail();}
  else if([command isEqual:@"inspect"]){if(args.count!=2||!CRPattern(args[1],@"[A-Za-z0-9_-]{22}"))CRFail();}
  else CRFail();
  CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root?:CRDefaultRoot(NO) allowFresh:NO];id pending=owner.installation[@"pendingRestore"];
  if(pendingID){if(pending==[NSNull null]||![pending[@"storeId"] isEqual:pendingID])CRFail();}
  else if(pending!=[NSNull null])CRFail();
  NSString *store=pendingID?:owner.installation[@"selectedStore"];
  if(activate||abandon){
    if(activate){if(![pending[@"status"] isEqual:@"complete"])CRFail();int verified=runJob(bundle,owner,@"maintenance",@"admin",store,@[@"verify-pending"]);if(verified)return verified;}
    [owner beginMetadataOperation:command pendingStore:store expectedSelection:pending[@"expectedSelection"]];
    NSMutableDictionary *value=[owner.installation mutableCopy];if(activate){value[@"selectedStore"]=store;value[@"setup"]=@"ready";}value[@"pendingRestore"]=[NSNull null];
    [owner publishInstallation:value];[owner finishOutcome:@"ok"];return 0;
  }
  if(restore){
    NSString *source=args[2];(void)CRPrivatePin(source,YES);NSData *marker=CRReadData([source stringByAppendingPathComponent:@"complete.json"],1024,YES);
    store=CRRandom(16);NSMutableDictionary *value=[owner.installation mutableCopy];value[@"pendingRestore"]=@{@"storeId":store,@"sourceDigest":CRSHA256(marker),@"expectedSelection":value[@"selectedStore"],@"status":@"reserved"};[owner publishInstallation:value];
  }
  int result=runJob(bundle,owner,prepare?@"prepare":@"maintenance",operation,store,prepare?@[]:args);
  if(restore){
    // runJob has already proved direct exit, drain acknowledgement and FD extinction.
    [owner assertHeld];NSDictionary *journal=CRReadJSON([owner.root stringByAppendingPathComponent:@"owner.json"],16384,YES);
    if(![journal[@"lifecycle"] isEqual:@"quiescent"]||[journal[@"outcome"] isEqual:@"uncertain"])return 1;
    NSMutableDictionary *value=[owner.installation mutableCopy],*next=[value[@"pendingRestore"] mutableCopy];next[@"status"]=result?@"failed":@"complete";value[@"pendingRestore"]=next;[owner publishInstallation:value];
  }
  if(!result&&(backup||restore)){
    NSDictionary *receipt=backup?@{@"status":@"backup-complete",@"path":[[owner.root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:owner.generation]}:@{@"status":@"restore-pending",@"storeId":store};
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:receipt options:0 error:nil];if(fwrite(bytes.bytes,1,bytes.length,stdout)!=bytes.length||putchar('\n')==EOF)CRFail();
  }
  if(result)fputs("Managed maintenance failed; state retained\n",stderr);
  return result;
}
