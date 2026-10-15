#import "demo-operation.h"
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
// Interpose only in this compiled test TU: force actual exit after the first
// no-event waitid, before the implementation's real getpgid. No production hook.
static BOOL forceExitRace,exitRaceInjected;static NSString *raceMarker;
static pid_t deterministicGetpgid(pid_t pid){
 if(forceExitRace){
  forceExitRace=NO;for(int i=0;i<500&&access(raceMarker.fileSystemRepresentation,F_OK);i++)usleep(1000);
  if(access(raceMarker.fileSystemRepresentation,F_OK)||kill(pid,SIGUSR1)){kill(pid,SIGKILL);int status;waitpid(pid,&status,0);return -1;}
  siginfo_t exited={0};int observed;do{observed=waitid(P_PID,(id_t)pid,&exited,WEXITED|WNOWAIT);}while(observed&&errno==EINTR);
  exitRaceInjected=!observed&&exited.si_pid==pid&&exited.si_code==CLD_EXITED;
 }
 return getpgid(pid);
}
#define getpgid deterministicGetpgid
#import <demo-operation.m>
#undef getpgid

@interface UncertainInventoryOperation : CRDemoOperation
@property NSInteger inventory;
@end
@implementation UncertainInventoryOperation
- (NSInteger)groupMembers{return self.inventory;}
@end
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=3)return 2;NSString *file=[NSString stringWithUTF8String:argv[1]],*kind=[NSString stringWithUTF8String:argv[2]];
 forceExitRace=[kind isEqual:@"exit-race"];raceMarker=[file stringByAppendingString:@".race-ready"];
 int leak=open("/dev/null",O_RDONLY);if(leak<0)return 2;
 BOOL inventoryCase=[kind hasPrefix:@"inventory-"],lostWait=[kind isEqual:@"lost-wait"];Class type=inventoryCase?UncertainInventoryOperation.class:CRDemoOperation.class;
 CRDemoOperation *op=[[type alloc] initWithExecutable:file arguments:@[(inventoryCase||lostWait)?@"normal":kind] directory:file.stringByDeletingLastPathComponent environment:@{@"PATH":@"/usr/bin:/bin"} timeout:0.4 grace:0.15];
 if(inventoryCase)((UncertainInventoryOperation *)op).inventory=[kind isEqual:@"inventory-empty"]?0:-1;
 if(lostWait){int status;while(waitpid(op.pid,&status,0)<0&&errno==EINTR){}}
 double deadline=CRLifecycleNow()+8;BOOL requested=NO;
 while(!op.finished&&!op.ownershipLost&&CRLifecycleNow()<deadline){[op pump];if([kind isEqual:@"graceful"]&&!requested&&op.output.length){requested=YES;[op cancel:@"User cancelled setup."];}usleep(5000);}
 close(leak);if([kind isEqual:@"exit-race"]&&!exitRaceInjected)return 6;
 if(inventoryCase||lostWait){if(!op.ownershipLost||op.finished)return 4;int status;pid_t waited=waitpid(op.pid,&status,0);if(inventoryCase&&waited!=op.pid)return 5;puts("{\"ownershipLost\":true,\"finished\":false}");return 0;}
 if(!op.finished){fprintf(stderr,"not settled: %s\n",op.failure.UTF8String);return 3;}
 int status=0;BOOL reaped=waitpid(op.pid,&status,WNOHANG)==-1&&errno==ECHILD;
 NSDictionary *result=@{@"success":@(op.success),@"finished":@(op.finished),@"reaped":@(reaped),@"cancelled":@(op.cancelled),@"outputBytes":@(op.output.length),@"output":[[NSString alloc] initWithData:op.output encoding:NSUTF8StringEncoding]?:@""};
 NSData *bytes=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);return 0;
}@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}}
