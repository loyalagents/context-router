#import "demo-ready.h"
#import "process.h"
#include <poll.h>
#include <math.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <unistd.h>
@implementation CRDemoReady { int _fd; NSString *_challenge; NSData *_answer; }
- (instancetype)initWithOwner:(CREnvelope *)owner endpoint:(NSString *)endpoint {
  self=[super init];if(!self)return nil;_fd=-1;
  [owner assertHeld];if(![owner.installation[@"mode"] isEqual:@"demo"])CRFail();
  _fd=socket(AF_INET,SOCK_STREAM,0);if(_fd<0||fcntl(_fd,F_SETFD,FD_CLOEXEC)||fcntl(_fd,F_SETFL,O_NONBLOCK))CRFail();
  struct sockaddr_in address={.sin_len=sizeof(address),.sin_family=AF_INET,.sin_addr={.s_addr=htonl(INADDR_LOOPBACK)}};socklen_t size=sizeof(address);
  if(bind(_fd,(struct sockaddr *)&address,size)||listen(_fd,4)||getsockname(_fd,(struct sockaddr *)&address,&size))CRFail();
  _challenge=CRRandom(32);
  NSDictionary *receipt=@{@"version":@1,@"installationId":owner.installation[@"installationId"],@"storeId":owner.installation[@"selectedStore"],@"generation":owner.generation,@"endpoint":endpoint,@"probePort":@(ntohs(address.sin_port)),@"challenge":_challenge};
  NSString *file=[[[owner.root stringByAppendingPathComponent:@"sessions"] stringByAppendingPathComponent:owner.generation] stringByAppendingPathComponent:@"demo-connection.json"];
  CRAtomicJSON(file,receipt);_answer=[NSJSONSerialization dataWithJSONObject:receipt options:0 error:nil];return self;
}
- (void)pump {
  if(_fd<0)return;
  // This endpoint observes native liveness only. It has no commands, database
  // access, credentials or lifecycle authority, and is closed before draining.
  for(int i=0;i<4;i++){
    int client=accept(_fd,NULL,NULL);if(client<0){if(errno==EWOULDBLOCK||errno==EAGAIN||errno==EINTR)return;CRFail();}
    struct timeval timeout={.tv_sec=0,.tv_usec=50000};int noSignal=1;
    (void)setsockopt(client,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));(void)setsockopt(client,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));(void)setsockopt(client,SOL_SOCKET,SO_NOSIGPIPE,&noSignal,sizeof(noSignal));
    (void)fcntl(client,F_SETFL,O_NONBLOCK);double deadline=CRLifecycleNow()+0.050;
    char bytes[65];ssize_t count=0;
    while(count<65&&CRLifecycleNow()<deadline){
      ssize_t n=recv(client,bytes+count,(size_t)(65-count),0);
      if(n>0){count+=n;continue;}if(!n)break;
      if(errno==EINTR)continue;if(errno!=EAGAIN&&errno!=EWOULDBLOCK)break;
      struct pollfd waiting={.fd=client,.events=POLLIN};(void)poll(&waiting,1,(int)ceil(MAX(0,deadline-CRLifecycleNow())*1000));
    }
    NSData *expected=[[_challenge stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
    if(count==(ssize_t)expected.length&&!memcmp(bytes,expected.bytes,expected.length)){
      (void)CRWriteBounded(client,_answer,deadline);
    }
    close(client);
  }
}
- (void)close {if(_fd>=0){close(_fd);_fd=-1;}}
- (void)dealloc {[self close];}
@end
