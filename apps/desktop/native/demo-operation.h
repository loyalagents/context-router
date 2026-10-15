#import <Foundation/Foundation.h>
#import "clocks.h"
#include <sys/types.h>

// Finite setup only. External Terminal/client sessions never enter this owner.
@interface CRDemoOperation : NSObject
@property(nonatomic,readonly) pid_t pid;
@property(nonatomic,readonly) BOOL finished,success,cancelled,ownershipLost;
@property(nonatomic,readonly) NSData *output,*errorOutput;
@property(nonatomic,readonly) NSString *failure;
- (instancetype)initWithExecutable:(NSString *)file arguments:(NSArray<NSString *> *)arguments directory:(NSString *)directory environment:(NSDictionary<NSString *,NSString *> *)environment timeout:(double)timeout grace:(double)grace;
- (void)pump;
- (void)cancel:(NSString *)reason;
@end
NSString *CRDemoLaunchRequest(NSString *root,NSString *executable,NSArray<NSString *> *arguments);
