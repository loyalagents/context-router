#import "package.h"
NSString *CRRandom(NSUInteger bytes);
NSString *CRBootID(void);
NSDictionary *CRPrivatePin(NSString *path, BOOL directory);
void CRPrivateDirectory(NSString *path, BOOL create);
void CRAtomicJSON(NSString *path, NSDictionary *value);
@interface CREnvelope : NSObject
@property(nonatomic, readonly) NSString *root;
@property(nonatomic, readonly) NSDictionary *installation;
@property(nonatomic, readonly) NSString *generation;
@property(nonatomic, readonly) BOOL fresh;
@property(nonatomic, readonly) int lockFD;
- (instancetype)initWithRoot:(NSString *)root allowFresh:(BOOL)allow;
- (void)assertHeld;
- (NSDictionary *)beginRole:(NSString *)role operation:(NSString *)operation store:(NSString *)store;
- (void)beginMetadataOperation:(NSString *)operation pendingStore:(NSString *)store expectedSelection:(NSString *)selected;
- (void)publishInstallation:(NSDictionary *)value;
- (void)finishOutcome:(NSString *)outcome;
@end
