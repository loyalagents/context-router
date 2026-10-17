#import "demo-operation.h"
#include <stdio.h>
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=4)return 2;NSString *root=[NSString stringWithUTF8String:argv[1]],*exe=[NSString stringWithUTF8String:argv[2]],*file=[NSString stringWithUTF8String:argv[3]];
 NSArray *arguments=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:file] options:0 error:nil];if(![arguments isKindOfClass:NSArray.class])return 2;
 puts(CRDemoLaunchRequest(root,exe,arguments).UTF8String);return 0;
}@catch(NSException *e){(void)e;return 1;}}}
