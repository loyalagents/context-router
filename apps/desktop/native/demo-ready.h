#import "envelope.h"
@interface CRDemoReady : NSObject
- (instancetype)initWithOwner:(CREnvelope *)owner endpoint:(NSString *)endpoint;
- (void)pump;
- (void)close;
@end
