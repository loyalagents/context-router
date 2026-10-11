#import "process.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

static void nonblocking(int fd) { int flags = fcntl(fd, F_GETFL); if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK)) CRFail(); }
BOOL CRWriteBounded(int fd, NSData *bytes, double deadline) {
  NSUInteger offset = 0;
  while (offset < bytes.length && CRLifecycleNow() < deadline) {
    ssize_t count = write(fd, (const char *)bytes.bytes + offset, bytes.length - offset);
    if (count > 0) offset += (NSUInteger)count;
    else if (count < 0 && (errno == EAGAIN || errno == EINTR)) { struct pollfd p = {.fd=fd,.events=POLLOUT}; (void)poll(&p,1,10); }
    else return NO;
  }
  return offset == bytes.length;
}
@implementation CRFrames { NSMutableData *_buffer; }
- (instancetype)init { self=[super init]; if(self)_buffer=[NSMutableData data]; return self; }
- (NSArray<NSDictionary *> *)readFrom:(int)fd {
  NSMutableArray *frames=[NSMutableArray array]; if(_ended)return frames;
  unsigned char bytes[4096]; NSUInteger received=0;
  // Bound both the incomplete record and work per event-loop iteration.
  while(received<65536) {
    ssize_t count=read(fd,bytes,sizeof(bytes));
    if(count<0) { if(errno==EAGAIN||errno==EWOULDBLOCK)break; if(errno==EINTR)continue; CRFail(); }
    if(!count) { _ended=YES; if(_buffer.length)CRFail(); break; }
    received+=(NSUInteger)count;
    for(ssize_t i=0;i<count;i++) {
      if(bytes[i]=='\n') {
        id value=[NSJSONSerialization JSONObjectWithData:_buffer options:0 error:nil];
        if(![value isKindOfClass:[NSDictionary class]])CRFail();
        [frames addObject:value]; [_buffer setLength:0];
        if(frames.count>256)CRFail();
      } else { if(_buffer.length>=16384)CRFail(); [_buffer appendBytes:bytes+i length:1]; }
    }
  }
  return frames;
}
@end
@implementation CRWriteQueue { int _fd; NSMutableData *_bytes; double _deadline; }
- (instancetype)initWithFD:(int)fd { self=[super init];if(self){_fd=fd;nonblocking(fd);_bytes=[NSMutableData data];}return self; }
- (BOOL)empty { return !_bytes.length; }
- (void)discard { _discarded=YES;[_bytes setLength:0]; }
- (void)append:(NSData *)data {
  if(_discarded)return;
  if(!data||data.length>16384||data.length+_bytes.length>32768)CRFail();
  if(!_bytes.length)_deadline=CRLifecycleNow()+2;[_bytes appendData:data];
}
- (void)flush {
  if(_discarded)return;
  if(!_bytes.length)return;
  ssize_t count=write(_fd,_bytes.bytes,_bytes.length);
  if(count>0)[_bytes replaceBytesInRange:NSMakeRange(0,(NSUInteger)count) withBytes:NULL length:0];
  else if(count==0||(errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK))CRFail();
  if(_bytes.length&&CRLifecycleNow()>=_deadline)CRFail();
}
@end
@implementation CRChild {
  int _input, _output, _capability;
  NSMutableData *_commands, *_admission;
  CRFrames *_frames;
  double _sendDeadline;
  BOOL _quitPending;
}
- (instancetype)initWithExecutable:(NSString *)file arguments:(NSArray<NSString *> *)arguments directory:(NSString *)directory lock:(int)lock capability:(NSDictionary *)capability role:(NSString *)role {
  self=[super init]; if(!self)return nil; _input=_output=_capability=_exitCode=-1; _role=[role copy];
  BOOL channels=capability!=nil||[role isEqual:@"download"],cliOutput=[role isEqual:@"maintenance"];
  _commands=[NSMutableData data]; _admission=[NSMutableData data]; _frames=[CRFrames new];
  if(capability) { NSData *bytes=[NSJSONSerialization dataWithJSONObject:capability options:0 error:nil]; if(!bytes||bytes.length>16384)CRFail(); [_admission appendData:bytes]; }
  int pipes[6]={-1,-1,-1,-1,-1,-1}, copies[5]={-1,-1,-1,-1,-1}, nullFD=-1;
  char **args=calloc(arguments.count+2,sizeof(char *)); if(!args)CRFail();
  args[0]=strdup(file.fileSystemRepresentation); for(NSUInteger i=0;i<arguments.count;i++)args[i+1]=strdup(arguments[i].UTF8String);
  const char *cwd=directory.fileSystemRepresentation; int maximum=getdtablesize();
  @try {
    for(NSUInteger i=0;i<arguments.count+1;i++)if(!args[i])CRFail();
    if((capability&&pipe(pipes))||(channels&&(pipe(pipes+2)||pipe(pipes+4))))CRFail();
    nullFD=open("/dev/null",O_RDWR|O_CLOEXEC); if(nullFD<0)CRFail();
    copies[0]=fcntl(lock,F_DUPFD_CLOEXEC,10); if(copies[0]<0)CRFail();
    if(capability){copies[1]=fcntl(pipes[0],F_DUPFD_CLOEXEC,10);if(copies[1]<0)CRFail();nonblocking(pipes[1]);}
    if(channels) {
      copies[2]=fcntl(pipes[2],F_DUPFD_CLOEXEC,10);copies[3]=fcntl(pipes[5],F_DUPFD_CLOEXEC,10);
      if(copies[2]<0||copies[3]<0)CRFail();
      nonblocking(pipes[3]);nonblocking(pipes[4]);
    }
    if(cliOutput){copies[4]=fcntl(STDOUT_FILENO,F_DUPFD_CLOEXEC,10);if(copies[4]<0)CRFail();}
    _sendDeadline=CRLifecycleNow()+5;
    // Prepare all Objective-C and allocation work before fork. Child is POSIX-only.
    _pid=fork(); if(_pid<0)CRFail();
    if(!_pid) {
      if(setsid()<0||chdir(cwd)||dup2(nullFD,0)<0||dup2(cliOutput?copies[4]:nullFD,1)<0||dup2(nullFD,2)<0||dup2(copies[0],3)<0)_exit(126);
      if(capability){if(dup2(copies[1],4)<0)_exit(126);}else close(4);
      if(channels){if(dup2(copies[2],5)<0||dup2(copies[3],6)<0)_exit(126);}else{close(5);close(6);}
      for(int fd=7;fd<maximum;fd++)close(fd);
      char *environment[]={"PATH=","NODE_ENV=production","NEXT_TELEMETRY_DISABLED=1","DO_NOT_TRACK=1",NULL};
      execve(args[0],args,environment);_exit(126);
    }
    if(capability){_capability=pipes[1];pipes[1]=-1;}
    if(channels){_input=pipes[3];pipes[3]=-1;_output=pipes[4];pipes[4]=-1;}
  } @finally {
    for(int i=0;i<6;i++)if(pipes[i]>=0)close(pipes[i]);for(int i=0;i<5;i++)if(copies[i]>=0)close(copies[i]);if(nullFD>=0)close(nullFD);
    for(NSUInteger i=0;i<arguments.count+1;i++)free(args[i]);free(args);
  }
  return self;
}
- (void)dealloc { if(_input>=0)close(_input);if(_output>=0)close(_output);if(_capability>=0)close(_capability); }
- (void)command:(NSString *)command generation:(NSString *)generation {
  if(_input<0||_exited||_protocolFailed)CRFail();
  NSData *bytes=[NSJSONSerialization dataWithJSONObject:@{@"version":@1,@"generation":generation,@"command":command} options:0 error:nil];
  if(!bytes||bytes.length+_commands.length+1>16384)CRFail();
  _quitPending=!_commands.length&&[command isEqual:@"quit"];
  if(!_commands.length)_sendDeadline=CRLifecycleNow()+2;
  [_commands appendData:bytes];[_commands appendBytes:"\n" length:1];
}
- (BOOL)flush:(NSMutableData *)data fd:(int)fd allowClosedQuit:(BOOL)allowClosedQuit {
  if(!data.length)return YES;
  ssize_t count=write(fd,data.bytes,data.length);
  if(count>0)[data replaceBytesInRange:NSMakeRange(0,(NSUInteger)count) withBytes:NULL length:0];
  // A completed child may close its command reader before its final status is
  // observed. Only a lone queued quit may tolerate EPIPE. Completion, exact exit
  // and drain remain mandatory; capability/start and malformed status still fail.
  else if(count<0&&errno==EPIPE&&allowClosedQuit){[data setLength:0];return NO;}
  else if(count==0||(errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK))CRFail();
  if(data.length&&CRLifecycleNow()>=_sendDeadline)CRFail();
  return YES;
}
- (NSArray<NSDictionary *> *)pump {
  NSArray *messages=@[];
  if(!_protocolFailed) @try {
    if(_capability>=0){[self flush:_admission fd:_capability allowClosedQuit:NO];if(!_admission.length){close(_capability);_capability=-1;}}
    if(_input>=0&&![self flush:_commands fd:_input allowClosedQuit:_quitPending]){close(_input);_input=-1;}
    if(_output>=0){messages=[_frames readFrom:_output];_statusEnded=_frames.ended;}
  } @catch(NSException *exception) {
    (void)exception;_protocolFailed=YES;
    if(_input>=0){close(_input);_input=-1;}if(_capability>=0){close(_capability);_capability=-1;}
  }
  if(!_exited&&!_ownershipLost) {
    int status;pid_t found=waitpid(_pid,&status,WNOHANG);
    if(found==_pid){_exited=YES;_exitCode=WIFEXITED(status)?WEXITSTATUS(status):-1;_success=_exitCode==0;
      // An exit may race the preceding read; consume final acknowledged records.
      if(!_protocolFailed&&_output>=0)@try {messages=[messages arrayByAddingObjectsFromArray:[_frames readFrom:_output]];_statusEnded=_frames.ended;}
      @catch(NSException *exception){(void)exception;_protocolFailed=YES;}
    } else if(found<0&&errno!=EINTR){
      // The PID may be recycled after lost wait ownership. Never signal it again.
      _ownershipLost=YES;_protocolFailed=YES;
      if(_input>=0){close(_input);_input=-1;}if(_capability>=0){close(_capability);_capability=-1;}
    }
  }
  return messages;
}
- (void)signal:(int)number { if(_ownershipLost)CRFail();if(!_exited&&kill(_pid,number)&&errno!=ESRCH)CRFail(); }
@end
