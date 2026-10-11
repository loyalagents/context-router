#import "diagnostics.h"
#include <stdio.h>
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();CREnvelope *owner=[[CREnvelope alloc] initWithRoot:[NSString stringWithUTF8String:argv[1]] allowFresh:YES];[owner beginRole:@"prepare" operation:@"initialize" store:owner.installation[@"selectedStore"]];
  for(int i=0;i<600;i++)CRDiagnostic(owner,@"starting");BOOL denied=NO;@try{CRDiagnostic(owner,@"untrusted raw secret");}@catch(NSException *e){(void)e;denied=YES;}[owner finishOutcome:@"ok"];return denied?0:2;
}@catch(NSException *e){(void)e;return 1;}}}
