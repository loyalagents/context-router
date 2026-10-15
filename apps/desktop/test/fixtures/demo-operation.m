#import "demo-operation.h"
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
@interface UncertainInventoryOperation : CRDemoOperation
@property NSInteger inventory;
@end
@implementation UncertainInventoryOperation
- (NSInteger)groupMembers{return self.inventory;}
@end
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=3)return 2;NSString *file=[NSString stringWithUTF8String:argv[1]],*kind=[NSString stringWithUTF8String:argv[2]];
 int leak=open("/dev/null",O_RDONLY);if(leak<0)return 2;
 BOOL inventoryCase=[kind hasPrefix:@"inventory-"],lostWait=[kind isEqual:@"lost-wait"];Class type=inventoryCase?UncertainInventoryOperation.class:CRDemoOperation.class;
 CRDemoOperation *op=[[type alloc] initWithExecutable:file arguments:@[(inventoryCase||lostWait)?@"normal":kind] directory:file.stringByDeletingLastPathComponent environment:@{@"PATH":@"/usr/bin:/bin"} timeout:0.4 grace:0.15];
 if(inventoryCase)((UncertainInventoryOperation *)op).inventory=[kind isEqual:@"inventory-empty"]?0:-1;
 if(lostWait){int status;while(waitpid(op.pid,&status,0)<0&&errno==EINTR){}}
 double deadline=CRLifecycleNow()+8;BOOL requested=NO;
 while(!op.finished&&!op.ownershipLost&&CRLifecycleNow()<deadline){[op pump];if([kind isEqual:@"graceful"]&&!requested&&op.output.length){requested=YES;[op cancel:@"User cancelled setup."];}usleep(5000);}
 close(leak);
 if(inventoryCase||lostWait){if(!op.ownershipLost||op.finished)return 4;int status;pid_t waited=waitpid(op.pid,&status,0);if(inventoryCase&&waited!=op.pid)return 5;puts("{\"ownershipLost\":true,\"finished\":false}");return 0;}
 if(!op.finished){fprintf(stderr,"not settled: %s\n",op.failure.UTF8String);return 3;}
 int status=0;BOOL reaped=waitpid(op.pid,&status,WNOHANG)==-1&&errno==ECHILD;
 NSDictionary *result=@{@"success":@(op.success),@"finished":@(op.finished),@"reaped":@(reaped),@"cancelled":@(op.cancelled),@"outputBytes":@(op.output.length),@"output":[[NSString alloc] initWithData:op.output encoding:NSUTF8StringEncoding]?:@""};
 NSData *bytes=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);return 0;
}@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}}
