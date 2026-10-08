#import "model-cleanup.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=3)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]],*variant=[NSString stringWithUTF8String:argv[2]];
  if([variant isEqual:@"admit"]){(void)[[CREnvelope alloc] initWithRoot:root allowFresh:NO];return 0;}
  CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root allowFresh:YES];[owner beginRole:@"prepare" operation:@"initialize" store:owner.installation[@"selectedStore"]];
  NSMutableDictionary *installation=[owner.installation mutableCopy];installation[@"setup"]=@"ready";[owner publishInstallation:installation];[owner finishOutcome:@"ok"];
  NSString *models=[root stringByAppendingPathComponent:@"models"],*file=[models stringByAppendingPathComponent:@".download-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.part"];
  int fd=open(file.fileSystemRepresentation,O_CREAT|O_EXCL|O_WRONLY,0600);if(fd<0||write(fd,"retain",6)!=6)CRFail();close(fd);
  NSDictionary *plan=CRPlanModelCleanup(owner);[owner beginModelCleanup];
  if([variant isEqual:@"interrupt"])_exit(7);
  if([variant isEqual:@"file"]){NSString *old=[root stringByAppendingPathComponent:@"retained-stage"];if(rename(file.fileSystemRepresentation,old.fileSystemRepresentation))CRFail();fd=open(file.fileSystemRepresentation,O_CREAT|O_EXCL|O_WRONLY,0600);if(fd<0||write(fd,"replacement",11)!=11)CRFail();close(fd);}
  if([variant isEqual:@"directory"]){NSString *old=[root stringByAppendingPathComponent:@"retained-models"];if(rename(models.fileSystemRepresentation,old.fileSystemRepresentation)||mkdir(models.fileSystemRepresentation,0700))CRFail();}
  @try{CRApplyModelCleanup(owner,plan);[owner finishOutcome:@"ok"];return [variant isEqual:@"normal"]?0:2;}@catch(NSException *e){(void)e;return [variant isEqual:@"normal"]?3:0;}
}@catch(NSException *e){(void)e;return 1;}}}
