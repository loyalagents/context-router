#import "diagnostics.h"
#include <sys/stat.h>
static NSArray *categories(void){return @[@"starting",@"ready",@"download-complete",@"download-cancelled",@"download-failed",@"stopped-ok",@"stopped-failed",@"stopped-uncertain"];}
void CRDiagnostic(CREnvelope *owner,NSString *category){
  [owner assertHeld];if(![categories() containsObject:category])CRFail();
  NSString *root=[owner.root stringByAppendingPathComponent:@"diagnostics"],*file=[root stringByAppendingPathComponent:@"events.json"],*previous=[root stringByAppendingPathComponent:@"previous.json"];
  (void)CRPrivatePin(root,YES);NSMutableArray *events=[NSMutableArray array];struct stat info;
  if(!lstat(file.fileSystemRepresentation,&info)){
    NSDictionary *value=CRReadJSON(file,16384,YES);
    if(!CRExact(value,@[@"version",@"release",@"platform",@"events"])||!CRInteger(value[@"version"],1,1)||![value[@"release"] isEqual:@"0.1.0-local-candidate"]||![value[@"platform"] isEqual:@"darwin-arm64"]||![value[@"events"] isKindOfClass:[NSArray class]]||[value[@"events"] count]>256)CRFail();
    for(id event in value[@"events"])if(!CRExact(event,@[@"category"])||![categories() containsObject:event[@"category"]])CRFail();
    [events addObjectsFromArray:value[@"events"]];
    if(events.count==256){if(!lstat(previous.fileSystemRepresentation,&info))(void)CRPrivatePin(previous,NO);else if(errno!=ENOENT)CRFail();CRAtomicJSON(previous,value);[events removeAllObjects];}
  }else if(errno!=ENOENT)CRFail();
  [events addObject:@{@"category":category}];CRAtomicJSON(file,@{@"version":@1,@"release":@"0.1.0-local-candidate",@"platform":@"darwin-arm64",@"events":events});[owner assertHeld];
}
