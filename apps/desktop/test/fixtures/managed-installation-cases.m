// Exercise the production static parser without adding a product API or opening
// an envelope. Shared grammar acceptance never grants managed authority.
#import "envelope.m"
#include <stdio.h>
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();NSData *bytes=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
  NSDictionary *corpus=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
  if(!CRExact(corpus,@[@"version",@"description",@"cases"])||!CRInteger(corpus[@"version"],1,1)||![corpus[@"cases"] isKindOfClass:NSArray.class])CRFail();
  NSMutableArray *results=[NSMutableArray array];
  for(NSDictionary *item in corpus[@"cases"]){
    BOOL accepted=YES;@try{installationValid(item[@"value"]);}@catch(NSException *error){(void)error;accepted=NO;}
    [results addObject:@{@"name":item[@"name"],@"accepted":@(accepted)}];
  }
  NSData *output=[NSJSONSerialization dataWithJSONObject:results options:0 error:nil];fwrite(output.bytes,1,output.length,stdout);puts("");return 0;
}@catch(NSException *error){(void)error;return 1;}}}
