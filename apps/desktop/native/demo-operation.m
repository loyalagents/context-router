#import "demo-operation.h"
#import "package.h"
#import "envelope.h"
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>

@implementation CRDemoOperation {
  int _outFD,_errFD,_exitCode;
  NSMutableData *_outBytes,*_errBytes;
  BOOL _leaderExited,_outEnded,_errEnded,_termComplete,_killed;
  double _deadline,_cancelDeadline,_grace,_exitObservationDeadline,_signalObservationDeadline;
}
- (instancetype)initWithExecutable:(NSString *)file arguments:(NSArray<NSString *> *)arguments directory:(NSString *)directory environment:(NSDictionary<NSString *,NSString *> *)environment timeout:(double)timeout grace:(double)grace {
  self=[super init];if(!self)return nil;_outFD=_errFD=_exitCode=-1;
  _outBytes=[NSMutableData data];_errBytes=[NSMutableData data];_grace=grace;_deadline=CRLifecycleNow()+timeout;
  int out[2]={-1,-1},err[2]={-1,-1};posix_spawn_file_actions_t actions;posix_spawnattr_t attributes;
  BOOL actionsReady=NO,attributesReady=NO;
  char **args=calloc(arguments.count+2,sizeof(char *)),**env=calloc(environment.count+1,sizeof(char *));
  @try{
    if(!args||!env||timeout<=0||grace<=0)CRFail();
    args[0]=strdup(file.fileSystemRepresentation);for(NSUInteger i=0;i<arguments.count;i++)args[i+1]=strdup(arguments[i].UTF8String);
    NSUInteger i=0;for(NSString *key in environment)env[i++]=strdup([[NSString stringWithFormat:@"%@=%@",key,environment[key]] UTF8String]);
    for(i=0;i<arguments.count+1;i++)if(!args[i])CRFail();for(i=0;i<environment.count;i++)if(!env[i])CRFail();
    if(pipe(out)||pipe(err)||posix_spawn_file_actions_init(&actions))CRFail();actionsReady=YES;
    if(posix_spawnattr_init(&attributes))CRFail();attributesReady=YES;
    for(i=0;i<2;i++)if(fcntl(out[i],F_SETFD,FD_CLOEXEC)||fcntl(err[i],F_SETFD,FD_CLOEXEC))CRFail();
    int reads[2]={out[0],err[0]};for(i=0;i<2;i++){int flags=fcntl(reads[i],F_GETFL);if(flags<0||fcntl(reads[i],F_SETFL,flags|O_NONBLOCK))CRFail();}
    if(posix_spawn_file_actions_addopen(&actions,0,"/dev/null",O_RDONLY,0)||posix_spawn_file_actions_adddup2(&actions,out[1],1)||posix_spawn_file_actions_adddup2(&actions,err[1],2)||posix_spawn_file_actions_addchdir_np(&actions,directory.fileSystemRepresentation))CRFail();
    sigset_t mask,defaults;sigemptyset(&mask);sigemptyset(&defaults);for(int s=1;s<NSIG;s++)if(s!=SIGKILL&&s!=SIGSTOP)sigaddset(&defaults,s);
    if(posix_spawnattr_setsigmask(&attributes,&mask)||posix_spawnattr_setsigdefault(&attributes,&defaults)||posix_spawnattr_setpgroup(&attributes,0)||posix_spawnattr_setflags(&attributes,POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_SETSIGMASK|POSIX_SPAWN_SETSIGDEF|POSIX_SPAWN_CLOEXEC_DEFAULT))CRFail();
    // Group creation and descriptor whitelist are atomic with spawn; no child
    // executes Objective-C after fork in the multithreaded AppKit process.
    int result=posix_spawn(&_pid,args[0],&actions,&attributes,args,env);if(result){_pid=0;CRFail();}
    _outFD=out[0];out[0]=-1;_errFD=err[0];err[0]=-1;
  }@finally{
    if(actionsReady)posix_spawn_file_actions_destroy(&actions);if(attributesReady)posix_spawnattr_destroy(&attributes);
    for(NSUInteger i=0;i<2;i++){if(out[i]>=0)close(out[i]);if(err[i]>=0)close(err[i]);}
    if(args){for(NSUInteger i=0;i<arguments.count+1;i++)free(args[i]);free(args);}if(env){for(NSUInteger i=0;i<environment.count;i++)free(env[i]);free(env);}
  }
  return self;
}
- (NSData *)output{return [_outBytes copy];}
- (NSData *)errorOutput{return [_errBytes copy];}
- (void)dealloc {if(_outFD>=0)close(_outFD);if(_errFD>=0)close(_errFD);}
- (BOOL)observeLeader {
  if(_ownershipLost||_finished)return NO;
  siginfo_t info={0};
  if(waitid(P_PID,(id_t)_pid,&info,WEXITED|WNOHANG|WNOWAIT)){if(errno==EINTR)return NO;_ownershipLost=YES;_failure=@"Setup process ownership is uncertain; retain state for inspection.";return NO;}
  if(info.si_pid){
    if(info.si_pid!=_pid||![ @[@(CLD_EXITED),@(CLD_KILLED),@(CLD_DUMPED)] containsObject:@(info.si_code)]){_ownershipLost=YES;return NO;}
    _leaderExited=YES;_exitCode=info.si_code==CLD_EXITED?info.si_status:-1;
  }
  // Darwin getpgid may reject a zombie. The complete group census below must
  // positively find the still-waitable leader before any post-exit signal.
  pid_t group=_leaderExited?_pid:getpgid(_pid);int groupError=errno;
  if(!_leaderExited&&group!=_pid){
    // Exit can occur after the no-event waitid above and before getpgid.
    // Reobserve that exact unreaped child, then positively find its held leader
    // in a complete group census. Empty/ECHILD/error is never exit proof.
    siginfo_t exited={0};int observed=waitid(P_PID,(id_t)_pid,&exited,WEXITED|WNOHANG|WNOWAIT);
    if(observed&&errno==EINTR)return NO;
    if(group==-1&&!observed&&exited.si_pid==_pid&&[@[@(CLD_EXITED),@(CLD_KILLED),@(CLD_DUMPED)] containsObject:@(exited.si_code)]&&[self groupMembers]>=1){
      _leaderExited=YES;_exitCode=exited.si_code==CLD_EXITED?exited.si_status:-1;
    }else if(group==-1&&groupError==ESRCH&&!observed&&!exited.si_pid&&!exited.si_code&&[self groupMembers]>=1){
      // Darwin can hide the exiting process from getpgid before waitid exposes
      // its exit. Keep the exact child and positive census, but neither signal
      // nor reap until proof is restored. Repeated observations never extend
      // this first-observation budget.
      double now=CRLifecycleNow();if(!_exitObservationDeadline)_exitObservationDeadline=now+5;
      if(now<_exitObservationDeadline)return NO;
      _ownershipLost=YES;_failure=@"Setup exit observation is uncertain; retain state for inspection.";return NO;
    }else{_ownershipLost=YES;_failure=@"Setup process group changed; retain state for inspection.";return NO;}
  }
  return YES;
}
- (NSInteger)groupMembers {
  pid_t members[4096]={0};int bytes=proc_listpids(PROC_PGRP_ONLY,(uint32_t)_pid,members,sizeof(members));
  if(bytes<=0||bytes>=(int)sizeof(members)||bytes%(int)sizeof(pid_t))return -1;
  BOOL leader=NO;NSMutableSet *seen=[NSMutableSet set];
  for(int i=0;i<bytes/(int)sizeof(pid_t);i++){
    if(members[i]<=0||[seen containsObject:@(members[i])])return -1;[seen addObject:@(members[i])];if(members[i]==_pid)leader=YES;
  }
  return leader?(NSInteger)seen.count:-1;
}
- (BOOL)signalGroup:(int)number {
  if(![self observeLeader])return NO;
  if(_leaderExited){NSInteger members=[self groupMembers];if(members<1){_ownershipLost=YES;_failure=@"Setup group ownership is uncertain; retain state.";return NO;}if(members==1)return YES;}
  if(kill(-_pid,number)){
    // The last live member can exit between census and kill. ESRCH is not
    // settlement: retain the exact waitable leader and continue census/drain.
    if(errno==ESRCH){
      if(![self observeLeader])return NO;
      if(_leaderExited){NSInteger members=[self groupMembers];if(members==1)return YES;
        if(members>1){
          // A complete census can include only zombies, but multiple members
          // are not settlement. Retry observation with a fixed bounded budget.
          double now=CRLifecycleNow();if(!_signalObservationDeadline)_signalObservationDeadline=now+5;
          if(now<_signalObservationDeadline)return NO;
        }
      }
    }
    _ownershipLost=YES;_failure=@"Setup group settlement could not be confirmed; retain state.";
    return NO;
  }
  _signalObservationDeadline=0;return YES;
}
- (void)advanceCancellation {
  if(!_cancelled||_finished||_ownershipLost)return;
  if(!_termComplete){if([self signalGroup:SIGTERM]){_termComplete=YES;_cancelDeadline=CRLifecycleNow()+_grace;}return;}
  if(!_killed&&CRLifecycleNow()>=_cancelDeadline&&[self signalGroup:SIGKILL]){_killed=YES;_cancelDeadline=CRLifecycleNow()+5;}
  if(_killed&&!_ownershipLost&&CRLifecycleNow()>=_cancelDeadline){_ownershipLost=YES;_failure=@"Setup shutdown is uncertain; retain state for inspection.";}
}
- (void)cancel:(NSString *)reason {
  if(_cancelled||_finished||_ownershipLost)return;_cancelled=YES;_failure=[reason copy];[self advanceCancellation];
}
- (void)read:(int)fd into:(NSMutableData *)bytes ended:(BOOL *)ended {
  if(*ended)return;unsigned char buffer[4096];NSUInteger received=0;
  while(received<16384){ssize_t n=read(fd,buffer,sizeof(buffer));
    if(n>0){received+=(NSUInteger)n;if(bytes.length+(NSUInteger)n<=65536)[bytes appendBytes:buffer length:(NSUInteger)n];else [self cancel:@"Setup output exceeded its safe limit; inspect retained state before retrying."];}
    else if(!n){*ended=YES;break;}
    else if(errno==EAGAIN||errno==EWOULDBLOCK)break;
    else if(errno!=EINTR){*ended=YES;[self cancel:@"Setup output was interrupted; inspect retained state before retrying."];break;}
  }
}
- (void)pump {
  if(_finished||_ownershipLost)return;
  [self read:_outFD into:_outBytes ended:&_outEnded];[self read:_errFD into:_errBytes ended:&_errEnded];
  if(![self observeLeader])return;
  if(_leaderExited){
    NSInteger members=[self groupMembers];
    if(members<1){_ownershipLost=YES;_failure=@"Setup group inventory is uncertain; retain state for inspection.";return;}
    if(members>1)[self cancel:@"Setup left a child running; its group is being stopped. Retain uncertain evidence."];
    else if(_outEnded&&_errEnded){
      // No process can now fork in this group: its sole member is this exact
      // waitable exited child. No group signal may occur after this reap.
      int status=0;pid_t reaped=waitpid(_pid,&status,WNOHANG);
      if(reaped!=_pid){if(reaped<0&&errno==EINTR)return;_ownershipLost=YES;_failure=@"Setup exit ownership was lost; retain state.";return;}
      _finished=YES;_success=!_cancelled&&_exitCode==0;return;
    }
  }
  if(!_cancelled&&CRLifecycleNow()>=_deadline)[self cancel:@"Setup timed out; inspect retained state before retrying."];
  [self advanceCancellation];
}
@end

static void demoDirectory(NSString *directory){
  (void)CRPrivatePin(directory,YES);
  for(NSString *current=directory;;current=current.stringByDeletingLastPathComponent){struct stat s;
    if(lstat(current.fileSystemRepresentation,&s)||!S_ISDIR(s.st_mode)||(s.st_uid!=0&&s.st_uid!=getuid())||((s.st_mode&022)&&!(s.st_uid==0&&(s.st_mode&S_ISVTX))))CRFail();
    if([current isEqual:@"/"])break;
  }
}
static void demoSync(NSString *directory){int fd=open(directory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)CRFail();int result=fsync(fd);close(fd);if(result)CRFail();}
NSString *CRDemoLaunchRequest(NSString *root,NSString *executable,NSArray<NSString *> *arguments){
  demoDirectory(root);NSString *demo=[root stringByAppendingPathComponent:@"demo"];demoDirectory(demo);
  NSString *requests=[demo stringByAppendingPathComponent:@"launch-requests"];
  if(mkdir(requests.fileSystemRepresentation,0700)&&errno!=EEXIST)CRFail();demoDirectory(requests);demoSync(demo);
  NSMutableString *script=[NSMutableString stringWithString:@"#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 TERM=xterm-256color"];
  for(NSString *argument in [@[executable] arrayByAddingObjectsFromArray:arguments]){
    if(![argument isKindOfClass:NSString.class]||[argument rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)CRFail();
    [script appendFormat:@" '%@'",[argument stringByReplacingOccurrencesOfString:@"'" withString:@"'\"'\"'"]];
  }
  [script appendString:@"\n"];NSData *bytes=[script dataUsingEncoding:NSUTF8StringEncoding];if(!bytes.length||bytes.length>16384)CRFail();
  NSString *request=[requests stringByAppendingPathComponent:CRRandom(16)];CRPrivateDirectory(request,YES);
  NSString *file=[request stringByAppendingPathComponent:@"open.command"];
  int fd=open(file.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0500);if(fd<0)CRFail();BOOL okay=YES;
  NSUInteger offset=0;while(offset<bytes.length){ssize_t n=write(fd,(const char *)bytes.bytes+offset,bytes.length-offset);if(n<0&&errno==EINTR)continue;if(n<=0){okay=NO;break;}offset+=(NSUInteger)n;}
  struct stat s;okay=okay&&!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==getuid()&&s.st_nlink==1&&(s.st_mode&07777)==0500&&!fsync(fd);if(close(fd))okay=NO;if(!okay)CRFail();demoSync(request);return file;
}
