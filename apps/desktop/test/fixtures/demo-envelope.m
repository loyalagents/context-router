#import "envelope.h"
#include <stdio.h>
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=3)CRFail();NSString *command=[NSString stringWithUTF8String:argv[1]];
  CREnvelope *owner=[[CREnvelope alloc] initWithRoot:[NSString stringWithUTF8String:argv[2]] allowFresh:[command isEqual:@"fresh"]];
  if([command isEqual:@"fresh"]){[owner beginRole:@"prepare" operation:@"initialize" store:owner.installation[@"selectedStore"]];[owner finishOutcome:@"ok"];}
  if([command isEqual:@"reserve"]){[owner reserveDemoWithSeed:@"historical-2024-2025-v1" hash:[@"e" stringByPaddingToLength:64 withString:@"e" startingAtIndex:0]];}
  if([command isEqual:@"candidate"]){id pending=owner.installation[@"pendingDemo"];NSDictionary *cap=[owner beginRole:@"demo-prepare" operation:@"initialize" store:pending[@"storeId"]];if(![cap[@"mode"] isEqual:@"demo"])CRFail();[owner finishOutcome:@"failed"];[owner failDemo];}
  if([command isEqual:@"retain"])[owner retainFailedDemo];
  NSData *bytes=[NSJSONSerialization dataWithJSONObject:owner.installation options:0 error:nil];fwrite(bytes.bytes,1,bytes.length,stdout);putchar('\n');return 0;
}@catch(NSException *e){(void)e;return 1;}}}
