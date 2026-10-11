#import "process.h"
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <unistd.h>
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  signal(SIGPIPE,SIG_IGN);if(argc!=3)CRFail();int fd=open(argv[2],O_CREAT|O_EXCL|O_RDWR,0600);if(fd<0)CRFail();
  CRChild *child=[[CRChild alloc] initWithExecutable:[NSString stringWithUTF8String:argv[1]] arguments:@[] directory:@"/" lock:fd capability:nil role:@"download"];
  [child command:@"start" generation:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];NSArray *messages=@[];double deadline=CRLifecycleNow()+3;
  while(!child.exited&&CRLifecycleNow()<deadline){messages=[messages arrayByAddingObjectsFromArray:[child pump]];usleep(1000);}close(fd);
  if(!child.exited||!child.success||child.protocolFailed||messages.count!=1)CRFail();NSData *bytes=[NSJSONSerialization dataWithJSONObject:messages[0] options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);return 0;
}@catch(NSException *e){(void)e;return 1;}}}
