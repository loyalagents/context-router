#import "envelope.h"
#include <sys/file.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
static NSString *root,*variant;
static int calls;
static pid_t contender=-1;
// Only envelope.m is compiled with flock renamed to this test wrapper.
int CRTestFlock(int fd,int operation){
  if(++calls==2){
    int ready[2];if(pipe(ready))CRFail();contender=fork();if(contender<0)CRFail();
    if(!contender){
      close(ready[0]);close(fd);
      int held=open([root stringByAppendingPathComponent:@"owner.lock"].fileSystemRepresentation,O_RDWR);
      if(held<0||flock(held,LOCK_EX|LOCK_NB))_exit(2);
      if([variant isEqual:@"inode"]){NSString *lock=[root stringByAppendingPathComponent:@"owner.lock"];if(unlink(lock.fileSystemRepresentation))_exit(3);int replacement=open(lock.fileSystemRepresentation,O_CREAT|O_EXCL|O_RDWR,0600);if(replacement<0)_exit(4);close(replacement);}
      if([variant isEqual:@"journal"]){NSString *file=[root stringByAppendingPathComponent:@"owner.json"];NSMutableDictionary *j=[CRReadJSON(file,16384,YES) mutableCopy];j[@"generation"]=CRRandom(16);CRAtomicJSON(file,j);}
      if(write(ready[1],"x",1)!=1)_exit(5);close(ready[1]);usleep([variant isEqual:@"persistent"]?400000:100000);close(held);_exit(0);
    }
    close(ready[1]);char byte;if(read(ready[0],&byte,1)!=1)CRFail();close(ready[0]);
  }
  return flock(fd,operation);
}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=3)CRFail();root=[NSString stringWithUTF8String:argv[1]];variant=[NSString stringWithUTF8String:argv[2]];
  CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root allowFresh:YES];[owner beginRole:@"prepare" operation:@"initialize" store:owner.installation[@"selectedStore"]];
  BOOL completed=NO;double before=NSProcessInfo.processInfo.systemUptime;
  @try{[owner finishOutcome:@"ok"];completed=YES;}@catch(NSException *e){(void)e;}
  double elapsed=NSProcessInfo.processInfo.systemUptime-before;int status;if(contender<=0||waitpid(contender,&status,0)!=contender||status)CRFail();
  printf("{\"completed\":%s,\"elapsed\":%.6f}\n",completed?"true":"false",elapsed);return 0;
}@catch(NSException *e){(void)e;return 1;}}}
