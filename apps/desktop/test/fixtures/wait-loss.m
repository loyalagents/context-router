#import "process.h"
#include <fcntl.h>
#include <sys/wait.h>
#include <stdio.h>
#include <unistd.h>
int main(int argc,const char **argv){@autoreleasepool{@try{
  if(argc!=2)CRFail();int lock=open(argv[1],O_RDWR|O_CREAT|O_EXCL,0600);if(lock<0)CRFail();
  CRChild *child=[[CRChild alloc] initWithExecutable:@"/usr/bin/true" arguments:@[] directory:@"/private/tmp" lock:lock capability:nil role:@"model"];
  int status;if(waitpid(child.pid,&status,0)!=child.pid)CRFail();(void)[child pump];
  BOOL denied=NO;@try{[child signal:0];}@catch(NSException *e){(void)e;denied=YES;}
  printf("{\"ownershipLost\":%s,\"signalDenied\":%s}\n",child.ownershipLost?"true":"false",denied?"true":"false");close(lock);return 0;
}@catch(NSException *e){(void)e;return 1;}}}
