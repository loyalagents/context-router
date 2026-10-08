#import "package.h"
#include <sys/types.h>
double CRNow(void);
@interface CRFrames : NSObject
@property(nonatomic, readonly) BOOL ended;
- (NSArray<NSDictionary *> *)readFrom:(int)fd;
@end
@interface CRWriteQueue : NSObject
@property(nonatomic, readonly) BOOL empty;
@property(nonatomic, readonly) BOOL discarded;
- (instancetype)initWithFD:(int)fd;
- (void)append:(NSData *)data;
- (void)flush;
- (void)discard;
@end
@interface CRChild : NSObject
@property(nonatomic, readonly) pid_t pid;
@property(nonatomic, readonly) BOOL exited;
@property(nonatomic, readonly) BOOL success;
@property(nonatomic, readonly) int exitCode;
@property(nonatomic, readonly) BOOL protocolFailed;
@property(nonatomic, readonly) BOOL statusEnded;
@property(nonatomic, readonly) BOOL ownershipLost;
@property(nonatomic, readonly) NSString *role;
- (instancetype)initWithExecutable:(NSString *)file arguments:(NSArray<NSString *> *)arguments directory:(NSString *)directory lock:(int)lock capability:(NSDictionary *)capability role:(NSString *)role;
- (NSArray<NSDictionary *> *)pump;
- (void)command:(NSString *)command generation:(NSString *)generation;
- (void)signal:(int)number;
@end
BOOL CRWriteBounded(int fd, NSData *bytes, double deadline);
