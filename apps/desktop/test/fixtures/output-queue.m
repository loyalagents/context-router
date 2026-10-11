#import "process.h"
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
int main(void){@autoreleasepool{@try{
  int fds[2];if(pipe(fds))CRFail();CRWriteQueue *queue=[[CRWriteQueue alloc] initWithFD:fds[1]];
  char bytes[16384]={0};while(write(fds[1],bytes,sizeof(bytes))>0){}
  [queue append:[NSData dataWithBytes:bytes length:1024]];
  double began=CRLifecycleNow();int ticks=0;BOOL denied=NO;
  @try{while(CRLifecycleNow()-began<3){[queue flush];ticks++;usleep(1000);}}@catch(NSException *e){(void)e;denied=YES;}
  BOOL bounded=denied&&ticks>100&&CRLifecycleNow()-began<3;
  BOOL overflow=NO;@try{[queue append:[NSData dataWithBytes:bytes length:16384]];[queue append:[NSData dataWithBytes:bytes length:16384]];}@catch(NSException *e){(void)e;overflow=YES;}
  close(fds[0]);close(fds[1]);printf("{\"responsive\":%s,\"bounded\":%s}\n",bounded?"true":"false",overflow?"true":"false");return 0;
}@catch(NSException *e){(void)e;return 1;}}}
