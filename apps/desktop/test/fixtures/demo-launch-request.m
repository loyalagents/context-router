#import "demo-operation.h"
#include <stdio.h>
#include <unistd.h>
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=3&&argc!=4)return 2;NSString *root=[NSString stringWithUTF8String:argv[1]],*request=CRDemoLaunchRequest(root,[NSString stringWithUTF8String:argv[2]],@[@"demo",@"--root",@"/a root's path",@"--executable",@"/native;$(false)'s",@"launch",@"A"]);
 if(argc==3){puts(request.UTF8String);return 0;}
 CRDemoOperation *operation=[[CRDemoOperation alloc] initWithExecutable:@"/bin/sh" arguments:@[request] directory:root environment:@{@"PATH":@"/usr/bin:/bin"} timeout:10 grace:1];double until=CRLifecycleNow()+15;while(!operation.finished&&CRLifecycleNow()<until){[operation pump];usleep(5000);}if(!operation.success)return 3;fwrite(operation.output.bytes,1,operation.output.length,stdout);return 0;
}@catch(NSException *e){(void)e;return 1;}}}
