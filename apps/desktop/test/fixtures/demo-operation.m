#import "demo-operation.h"
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <string.h>
// Interpose only in this compiled test TU: force actual exit after the first
// no-event waitid, before the implementation's real getpgid. No production hook.
static BOOL forceExitRace,exitRaceInjected,maskForever,killExitRace,repeatSignalESRCH;static int maskRemaining,maskedExits,groupSignals,refusedSignals;static NSString *raceMarker;
static BOOL forceActualExit(pid_t pid){
 for(int i=0;i<500&&access(raceMarker.fileSystemRepresentation,F_OK);i++)usleep(1000);
 if(access(raceMarker.fileSystemRepresentation,F_OK)||kill(pid,SIGUSR1))return NO;
 siginfo_t exited={0};int observed;do{observed=waitid(P_PID,(id_t)pid,&exited,WEXITED|WNOWAIT);}while(observed&&errno==EINTR);
 return exitRaceInjected=!observed&&exited.si_pid==pid&&exited.si_code==CLD_EXITED;
}
static pid_t deterministicGetpgid(pid_t pid){
 if(forceExitRace){
  forceExitRace=NO;if(!forceActualExit(pid)){kill(pid,SIGKILL);int status;waitpid(pid,&status,0);return -1;}
 }
 return getpgid(pid);
}
static int deterministicWaitid(idtype_t type,id_t pid,siginfo_t *info,int options){
 int result=waitid(type,pid,info,options);
 if(!result&&exitRaceInjected&&info->si_pid==(pid_t)pid&&(options&WNOHANG)&&(maskForever||maskRemaining>0)){
  memset(info,0,sizeof(*info));if(maskRemaining>0)maskRemaining--;maskedExits++;
 }
 return result;
}
static int deterministicKill(pid_t pid,int number){
 if(repeatSignalESRCH&&pid<0){refusedSignals++;errno=ESRCH;return -1;}
 if(killExitRace&&pid<0&&number==SIGKILL){
  killExitRace=NO;if(!forceActualExit(-pid))return -1;maskRemaining=2;errno=ESRCH;return -1;
 }
 if(pid<0)groupSignals++;return kill(pid,number);
}
#define getpgid deterministicGetpgid
#define waitid deterministicWaitid
#define kill deterministicKill
#import <demo-operation.m>
#undef getpgid
#undef waitid
#undef kill

@interface UncertainInventoryOperation : CRDemoOperation
@property NSInteger inventory;
@end
@implementation UncertainInventoryOperation
- (NSInteger)groupMembers{return self.inventory;}
@end
@interface PendingKillOperation : CRDemoOperation
@property BOOL injected;
@end
@implementation PendingKillOperation
- (BOOL)signalGroup:(int)number {
 if(number==SIGKILL&&!self.injected){self.injected=YES;forceExitRace=YES;maskRemaining=1;}
 return [super signalGroup:number];
}
@end
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=3)return 2;NSString *file=[NSString stringWithUTF8String:argv[1]],*kind=[NSString stringWithUTF8String:argv[2]];
 BOOL transient=[kind hasPrefix:@"exit-transient"],stuck=[kind isEqual:@"exit-transient-stuck"],cancelTransient=[kind isEqual:@"exit-transient-cancel"],killTransient=[kind isEqual:@"kill-transient"],pendingKill=[kind isEqual:@"kill-observation-transient"],changedGroup=[kind isEqual:@"changed-group"];
 repeatSignalESRCH=[kind isEqual:@"signal-esrch-stuck"];
 forceExitRace=[kind isEqual:@"exit-race"]||transient;maskRemaining=transient?1:0;maskForever=stuck;killExitRace=killTransient;
 raceMarker=[file stringByAppendingString:@".race-ready"];if(forceExitRace||killTransient||pendingKill)unlink(raceMarker.fileSystemRepresentation);
 int leak=open("/dev/null",O_RDONLY);if(leak<0)return 2;
 BOOL inventoryCase=[kind hasPrefix:@"inventory-"],lostWait=[kind isEqual:@"lost-wait"];Class type=inventoryCase?UncertainInventoryOperation.class:(pendingKill?PendingKillOperation.class:CRDemoOperation.class);
 NSString *childKind=(inventoryCase||lostWait)?@"normal":(forceExitRace?@"exit-race":((killTransient||pendingKill)?@"exit-race-tree":(repeatSignalESRCH?@"silent":kind)));
 CRDemoOperation *op=[[type alloc] initWithExecutable:file arguments:@[childKind] directory:file.stringByDeletingLastPathComponent environment:@{@"PATH":@"/usr/bin:/bin"} timeout:0.4 grace:0.15];
 if(inventoryCase)((UncertainInventoryOperation *)op).inventory=[kind isEqual:@"inventory-empty"]?0:-1;
 if(lostWait){int status;while(waitpid(op.pid,&status,0)<0&&errno==EINTR){}}
 double began=CRLifecycleNow(),deadline=began+8;BOOL requested=NO;if(cancelTransient)[op cancel:@"User cancelled during exit observation."];
 while(!op.finished&&!op.ownershipLost&&CRLifecycleNow()<deadline){[op pump];if([kind isEqual:@"graceful"]&&!requested&&op.output.length){requested=YES;[op cancel:@"User cancelled setup."];}usleep(5000);}
 close(leak);if(([kind isEqual:@"exit-race"]||transient||killTransient||pendingKill)&&!exitRaceInjected)return 6;
 if(transient&&(!maskedExits||groupSignals))return 7;
 if(stuck){if(!op.ownershipLost||op.finished||CRLifecycleNow()-began<4.9||CRLifecycleNow()-began>7)return 8;int status;if(waitpid(op.pid,&status,0)!=op.pid)return 9;puts("{\"ownershipLost\":true,\"finished\":false}");return 0;}
 if(killTransient&&(maskedExits!=2||groupSignals<2))return 10;
 if(pendingKill&&(maskedExits!=1||groupSignals<2))return 11;
 if(repeatSignalESRCH||changedGroup){
  BOOL expected=op.ownershipLost&&!op.finished&&!groupSignals&&(!repeatSignalESRCH||(refusedSignals>2&&CRLifecycleNow()-began>=4.9&&CRLifecycleNow()-began<7));
  // Test-owned cleanup only: retain exact wait identity; never signal the
  // changed foreign group. Production correctly retains uncertain ownership.
  siginfo_t exact={0};if(waitid(P_PID,(id_t)op.pid,&exact,WEXITED|WNOHANG|WNOWAIT))return 12;
  if(repeatSignalESRCH){if(exact.si_pid!=op.pid||[op groupMembers]<1)return 13;kill(-op.pid,SIGKILL);double settle=CRLifecycleNow()+2;while([op groupMembers]>1&&CRLifecycleNow()<settle)usleep(1000);if([op groupMembers]!=1)return 14;}
  else if(!exact.si_pid)kill(op.pid,SIGKILL);
  int status;if(waitpid(op.pid,&status,0)!=op.pid)return 15;if(!expected)return 16;puts("{\"ownershipLost\":true,\"finished\":false}");return 0;
 }
 if(inventoryCase||lostWait){if(!op.ownershipLost||op.finished)return 4;int status;pid_t waited=waitpid(op.pid,&status,0);if(inventoryCase&&waited!=op.pid)return 5;puts("{\"ownershipLost\":true,\"finished\":false}");return 0;}
 if(!op.finished){fprintf(stderr,"not settled: %s\n",op.failure.UTF8String);return 3;}
 int status=0;BOOL reaped=waitpid(op.pid,&status,WNOHANG)==-1&&errno==ECHILD;
 NSDictionary *result=@{@"success":@(op.success),@"finished":@(op.finished),@"reaped":@(reaped),@"cancelled":@(op.cancelled),@"outputBytes":@(op.output.length),@"output":[[NSString alloc] initWithData:op.output encoding:NSUTF8StringEncoding]?:@""};
 NSData *bytes=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);return 0;
}@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}}
