#import <Foundation/Foundation.h>
NSString *CRBundleRoot(void);
NSDictionary *CRVerifyPackage(NSString *root);
NSString *CRSHA256(NSData *bytes);
NSDictionary *CRReadJSON(NSString *file, NSUInteger maximum, BOOL privateFile);
NSData *CRReadData(NSString *file, NSUInteger maximum, BOOL privateFile);
BOOL CRExact(id value, NSArray<NSString *> *keys);
BOOL CRInteger(id value, long long minimum, long long maximum);
BOOL CRPattern(id value, NSString *pattern);
void CRFail(void);
