#import "envelope.h"
#import "clocks.h"
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <fcntl.h>
#include <limits.h>
#include <unistd.h>

NSString *CRRandom(NSUInteger count) {
  if (count < 1 || count > 64) CRFail();
  unsigned char bytes[64]; arc4random_buf(bytes, count);
  NSMutableString *result = [NSMutableString stringWithCapacity:count * 2];
  for (NSUInteger i = 0; i < count; i++) [result appendFormat:@"%02x", bytes[i]];
  memset(bytes, 0, sizeof(bytes)); return result;
}
NSString *CRBootID(void) {
  char bytes[65] = {0}; size_t size = sizeof(bytes);
  if (sysctlbyname("kern.bootsessionuuid", bytes, &size, NULL, 0) || size < 2 || size > sizeof(bytes)) CRFail();
  NSString *result = [NSString stringWithUTF8String:bytes];
  if (!CRPattern(result, @"[A-Za-z0-9-]{1,64}")) CRFail(); return result;
}
static NSDictionary *inode(struct stat info) { return @{@"dev": @(info.st_dev), @"ino": @(info.st_ino)}; }
NSDictionary *CRPrivatePin(NSString *file, BOOL directory) {
  struct stat info; char resolved[PATH_MAX];
  if (lstat(file.fileSystemRepresentation, &info) || info.st_uid != getuid() ||
      (info.st_mode & 07777) != (directory ? 0700 : 0600) ||
      (directory ? !S_ISDIR(info.st_mode) : !S_ISREG(info.st_mode) || info.st_nlink != 1) ||
      !realpath(file.fileSystemRepresentation, resolved) || ![file isEqual:[NSString stringWithUTF8String:resolved]]) CRFail();
  return inode(info);
}
static void syncDirectory(NSString *dir) {
  int fd = open(dir.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) CRFail(); int outcome = fsync(fd); close(fd); if (outcome) CRFail();
}
void CRPrivateDirectory(NSString *dir, BOOL create) {
  if (create && mkdir(dir.fileSystemRepresentation, 0700)) CRFail();
  (void)CRPrivatePin(dir, YES);
  if (create) syncDirectory(dir.stringByDeletingLastPathComponent);
}
void CRAtomicJSON(NSString *file, NSDictionary *value) {
  NSData *bytes = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  if (!bytes || !bytes.length || bytes.length > 16384) CRFail();
  NSString *stage = [file stringByAppendingFormat:@".stage-%@", CRRandom(16)];
  int fd = open(stage.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) CRFail();
  NSUInteger offset = 0; BOOL okay = YES;
  while (offset < bytes.length) {
    ssize_t n = write(fd, (const char *)bytes.bytes + offset, bytes.length - offset);
    if (n <= 0) { okay = NO; break; } offset += (NSUInteger)n;
  }
  okay = okay && !fsync(fd); if (close(fd)) okay = NO;
  // Preserve interrupted staging/publication for named reconciliation.
  if (!okay || rename(stage.fileSystemRepresentation, file.fileSystemRepresentation)) CRFail();
  syncDirectory(file.stringByDeletingLastPathComponent);
}
static void installationValid(NSDictionary *m) {
  if (!CRExact(m, @[@"version", @"installationId", @"selectedStore", @"minimumEpoch", @"setup", @"pendingRestore"]) ||
      !CRInteger(m[@"version"], 1, 1) || !CRPattern(m[@"installationId"], @"[a-f0-9]{32}") || !CRPattern(m[@"selectedStore"], @"[a-f0-9]{32}") ||
      !CRInteger(m[@"minimumEpoch"], 1, 1) || ![@[@"initializing", @"ready", @"failed"] containsObject:m[@"setup"]]) CRFail();
  id p = m[@"pendingRestore"];
  if (p != [NSNull null] && (!CRExact(p, @[@"storeId", @"sourceDigest", @"expectedSelection", @"status"]) ||
      !CRPattern(p[@"storeId"], @"[a-f0-9]{32}") || !CRPattern(p[@"sourceDigest"], @"[a-f0-9]{64}") ||
      ![p[@"expectedSelection"] isEqual:m[@"selectedStore"]] || ![@[@"reserved", @"complete", @"failed"] containsObject:p[@"status"]])) CRFail();
}
static BOOL roleOperationValid(NSString *role, NSString *operation) {
  NSDictionary *operations = @{@"prepare": @[@"initialize", @"initialize-recovered", @"verify", @"resume-setup"], @"application": @[@"serve"],
    @"maintenance": @[@"admin", @"backup", @"restore", @"recover-bootstrap", @"recover-identity", @"resume-setup"],@"metadata":@[@"activate-restore",@"abandon-restore",@"cleanup-downloads"]};
  return [role isKindOfClass:[NSString class]] && [operation isKindOfClass:[NSString class]] && [operations[role] containsObject:operation];
}
static void journalValid(NSDictionary *j, NSDictionary *m) {
  if (!CRExact(j, @[@"version", @"lifecycle", @"outcome", @"generation", @"bootId", @"installationId", @"storeId", @"role", @"operation", @"nonceHash"]) ||
      !CRInteger(j[@"version"], 1, 1) || ![@[@"active", @"quiescent"] containsObject:j[@"lifecycle"]] ||
      ![@[@"pending", @"ok", @"failed", @"uncertain"] containsObject:j[@"outcome"]] ||
      !CRPattern(j[@"generation"], @"[a-f0-9]{32}") || !CRPattern(j[@"bootId"], @"[A-Za-z0-9-]{1,64}") ||
      ![j[@"installationId"] isEqual:m[@"installationId"]] || !CRPattern(j[@"storeId"], @"[a-f0-9]{32}") ||
      !CRPattern(j[@"nonceHash"], @"[a-f0-9]{64}") || !roleOperationValid(j[@"role"], j[@"operation"])) CRFail();
  if (([j[@"lifecycle"] isEqual:@"active"] && ![j[@"outcome"] isEqual:@"pending"]) ||
      ([j[@"lifecycle"] isEqual:@"quiescent"] && [j[@"outcome"] isEqual:@"pending"])) CRFail();
}
@implementation CREnvelope {
  NSMutableDictionary<NSString *, NSDictionary *> *_roots;
  NSDictionary *_lockPin, *_installationPin, *_journalPin, *_journal;
  NSString *_boot;
  BOOL _poisoned;
}
- (instancetype)initWithRoot:(NSString *)root allowFresh:(BOOL)allow {
  self = [super init]; if (!self) return nil; _lockFD = -1;
  if (![root isKindOfClass:[NSString class]] || root.length > 4096 || !root.isAbsolutePath || ![root.lastPathComponent isEqual:@"managed-v1"] ||
      [root rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location != NSNotFound) CRFail();
  // Foundation standardization can rewrite existing /private paths to aliases.
  // Lexical validation and realpath/inode admission are deliberately separate.
  NSArray *parts = [root componentsSeparatedByString:@"/"];
  for (NSUInteger i = 1; i < parts.count; i++)
    if (![parts[i] length] || [parts[i] isEqual:@"."] || [parts[i] isEqual:@".."]) CRFail();
  _root = [root copy]; _roots = [NSMutableDictionary dictionary];
  NSString *parent = root.stringByDeletingLastPathComponent;
  NSMutableArray *ancestry = [NSMutableArray array];
  while (YES) { [ancestry insertObject:parent atIndex:0]; if ([parent isEqual:@"/"]) break; parent = parent.stringByDeletingLastPathComponent; }
  for (NSUInteger index = 0; index < ancestry.count; index++) {
    NSString *dir = ancestry[index]; struct stat info; char canonical[PATH_MAX];
    if (lstat(dir.fileSystemRepresentation, &info) || !S_ISDIR(info.st_mode) || (info.st_uid != 0 && info.st_uid != getuid()) ||
        !realpath(dir.fileSystemRepresentation, canonical) || ![dir isEqual:[NSString stringWithUTF8String:canonical]]) CRFail();
    if (info.st_mode & 0022) {
      struct stat next;
      if (info.st_uid != 0 || !(info.st_mode & S_ISVTX) || index + 1 >= ancestry.count ||
          lstat([ancestry[index + 1] fileSystemRepresentation], &next) || next.st_uid != getuid()) CRFail();
    }
    _roots[dir] = @{@"dev": @(info.st_dev), @"ino": @(info.st_ino), @"mode": @(info.st_mode), @"uid": @(info.st_uid)};
  }
  struct stat existing;
  if (lstat(root.fileSystemRepresentation, &existing)) {
    if (errno != ENOENT || !allow) CRFail();
    CRPrivateDirectory(root, YES);
  } else CRPrivateDirectory(root, NO);
  NSArray *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:root error:nil];
  if (!entries) CRFail(); _fresh = entries.count == 0;
  if (_fresh && !allow) CRFail();
  NSString *lock = [root stringByAppendingPathComponent:@"owner.lock"];
  if (!_fresh) (void)CRPrivatePin(lock, NO);
  _lockFD = open(lock.fileSystemRepresentation, O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (_fresh ? O_CREAT | O_EXCL : 0), 0600);
  if (_lockFD < 0 || flock(_lockFD, LOCK_EX | LOCK_NB)) CRFail();
  _lockPin = CRPrivatePin(lock, NO);
  if (_fresh) { if (fsync(_lockFD)) CRFail(); syncDirectory(root); }
  _roots[root] = CRPrivatePin(root, YES);
  _boot = CRBootID();
  NSSet *allowed = [NSSet setWithArray:@[@"installation.json", @"owner.lock", @"owner.json", @"stores", @"models", @"sessions", @"exports", @"diagnostics"]];
  for (NSString *name in entries) if (![allowed containsObject:name]) CRFail();
  for (NSString *name in @[@"stores", @"models", @"sessions", @"exports", @"diagnostics"]) {
    NSString *dir = [root stringByAppendingPathComponent:name]; CRPrivateDirectory(dir, _fresh); _roots[dir] = CRPrivatePin(dir, YES);
  }
  NSString *manifest = [root stringByAppendingPathComponent:@"installation.json"];
  if (_fresh) {
    _installation = @{@"version": @1, @"installationId": CRRandom(16), @"selectedStore": CRRandom(16), @"minimumEpoch": @1, @"setup": @"initializing", @"pendingRestore": [NSNull null]};
    CRPrivateDirectory([[root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:_installation[@"selectedStore"]], YES);
    CRAtomicJSON(manifest, _installation);
  } else {
    _installation = CRReadJSON(manifest, 16384, YES); installationValid(_installation);
    NSString *journal = [root stringByAppendingPathComponent:@"owner.json"];
    _journal = CRReadJSON(journal, 16384, YES); journalValid(_journal, _installation);
    _journalPin = CRPrivatePin(journal, NO);
    if (![_journal[@"lifecycle"] isEqual:@"quiescent"] || [_journal[@"outcome"] isEqual:@"uncertain"]) CRFail();
  }
  _installationPin = CRPrivatePin(manifest, NO);
  [self assertHeld]; return self;
}
- (void)dealloc { if (_lockFD >= 0) close(_lockFD); }
- (void)assertHeld {
  struct stat held;
  if (_poisoned || _lockFD < 0 || fstat(_lockFD, &held) || ![inode(held) isEqual:_lockPin] ||
      ![CRPrivatePin([_root stringByAppendingPathComponent:@"owner.lock"], NO) isEqual:_lockPin]) CRFail();
  for (NSString *dir in _roots) {
    NSDictionary *p = _roots[dir]; struct stat current;
    if (p[@"mode"]) {
      if (lstat(dir.fileSystemRepresentation, &current) || current.st_mode != [p[@"mode"] unsignedIntValue] ||
          current.st_uid != [p[@"uid"] unsignedIntValue] || ![inode(current) isEqual:@{@"dev":p[@"dev"], @"ino":p[@"ino"]}]) CRFail();
    } else if (![CRPrivatePin(dir, YES) isEqual:p]) CRFail();
  }
  NSString *file = [_root stringByAppendingPathComponent:@"installation.json"];
  if (![CRPrivatePin(file, NO) isEqual:_installationPin] || ![CRReadJSON(file, 16384, YES) isEqual:_installation]) CRFail();
  if (_journal) {
    file = [_root stringByAppendingPathComponent:@"owner.json"];
    if (![CRPrivatePin(file, NO) isEqual:_journalPin] || ![CRReadJSON(file, 16384, YES) isEqual:_journal]) CRFail();
  }
}
- (void)publishInstallation:(NSDictionary *)value {
  [self assertHeld]; installationValid(value);
  if (![value[@"installationId"] isEqual:_installation[@"installationId"]] ||
      [value[@"minimumEpoch"] longLongValue] < [_installation[@"minimumEpoch"] longLongValue]) CRFail();
  NSString *file = [_root stringByAppendingPathComponent:@"installation.json"];
  CRAtomicJSON(file, value); _installation = [value copy]; _installationPin = CRPrivatePin(file, NO);
}
- (NSDictionary *)beginRole:(NSString *)role operation:(NSString *)operation store:(NSString *)store {
  [self assertHeld];
  if ([role isEqual:@"metadata"] || !roleOperationValid(role, operation) || !CRPattern(store, @"[a-f0-9]{32}")) CRFail();
  id pending = _installation[@"pendingRestore"];
  if (pending != [NSNull null]) {
    if (![role isEqual:@"maintenance"] || ![@[@"admin", @"restore"] containsObject:operation] || ![store isEqual:pending[@"storeId"]]) CRFail();
  } else if (![store isEqual:_installation[@"selectedStore"]] || [operation isEqual:@"restore"]) CRFail();
  if (([role isEqual:@"application"] || [operation isEqual:@"verify"]) && ![_installation[@"setup"] isEqual:@"ready"]) CRFail();
  if ([operation isEqual:@"initialize"] && (!_fresh || ![_installation[@"setup"] isEqual:@"initializing"])) CRFail();
  BOOL recovered = [operation isEqual:@"initialize-recovered"];
  BOOL bootstrapRecovered = recovered && [_journal[@"operation"] isEqual:@"recover-bootstrap"];
  if (recovered && ([_installation[@"setup"] isEqual:@"ready"] || ![_journal[@"lifecycle"] isEqual:@"quiescent"] ||
      ![_journal[@"outcome"] isEqual:@"ok"] || ![@[@"recover-identity",@"recover-bootstrap"] containsObject:_journal[@"operation"]] || ![_journal[@"storeId"] isEqual:store])) CRFail();
  _generation = _generation ?: CRRandom(16);
  NSString *nonce = CRRandom(32), *pair = [[_root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:store];
  if (![operation isEqual:@"restore"]) { CRPrivateDirectory(pair, NO); _roots[pair] = CRPrivatePin(pair, YES); }
  id dataPin = [NSNull null], identityPin = [NSNull null], target = [NSNull null];
  for (NSString *name in @[@"data", @"identity"]) {
    NSString *dir = [pair stringByAppendingPathComponent:name]; struct stat s;
    if (lstat(dir.fileSystemRepresentation, &s)) { if (errno != ENOENT) CRFail(); continue; }
    if ([operation isEqual:@"initialize"] || [operation isEqual:@"restore"]) CRFail();
    NSDictionary *p = CRPrivatePin(dir, YES); _roots[dir] = p;
    if ([name isEqual:@"data"]) dataPin = p;
    else {
      identityPin = p;
      if (recovered) {
        NSArray *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil];
        if (!entries || entries.count) CRFail();
      } else if (![@[@"recover-identity", @"recover-bootstrap"] containsObject:operation]) {
        target = CRReadJSON([dir stringByAppendingPathComponent:@"identity.json"], 16384, YES)[@"databaseTargetId"];
        if (!CRPattern(target, @"[A-Za-z0-9_-]{43}")) CRFail();
      }
    }
  }
  if (([role isEqual:@"application"] || [@[@"verify", @"admin", @"backup"] containsObject:operation]) &&
      (dataPin == [NSNull null] || identityPin == [NSNull null] || target == [NSNull null])) CRFail();
  if ((recovered || [operation isEqual:@"recover-identity"]) && (dataPin == [NSNull null] || (identityPin == [NSNull null] && !bootstrapRecovered))) CRFail();
  _journal = @{@"version": @1, @"lifecycle": @"active", @"outcome": @"pending", @"generation": _generation, @"bootId": _boot,
    @"installationId": _installation[@"installationId"], @"storeId": store, @"role": role, @"operation": operation,
    @"nonceHash": CRSHA256([nonce dataUsingEncoding:NSUTF8StringEncoding])};
  NSString *journal = [_root stringByAppendingPathComponent:@"owner.json"];
  CRAtomicJSON(journal, _journal); _journalPin = CRPrivatePin(journal, NO);
  return @{@"version": @1, @"epoch": @1, @"envelope": _root, @"installationId": _installation[@"installationId"], @"storeId": store,
    @"generation": _generation, @"bootId": _boot, @"role": role, @"operation": operation, @"nonce": nonce,
    @"envelopePin": _roots[_root], @"lockPin": _lockPin, @"dataPin": dataPin, @"identityPin": identityPin, @"targetId": target};
}
- (void)beginMetadataOperation:(NSString *)operation pendingStore:(NSString *)store expectedSelection:(NSString *)selected {
  [self assertHeld];id pending=_installation[@"pendingRestore"];
  if(![@[@"activate-restore",@"abandon-restore"] containsObject:operation]||!CRPattern(store,@"[a-f0-9]{32}")||pending==[NSNull null]||
    ![pending[@"storeId"] isEqual:store]||![pending[@"expectedSelection"] isEqual:selected]||![_installation[@"selectedStore"] isEqual:selected]||
    ![_journal[@"lifecycle"] isEqual:@"quiescent"]||[_journal[@"outcome"] isEqual:@"uncertain"])CRFail();
  if([operation isEqual:@"activate-restore"]&&(![pending[@"status"] isEqual:@"complete"]||![_journal[@"outcome"] isEqual:@"ok"]||
    ![_journal[@"role"] isEqual:@"maintenance"]||![_journal[@"operation"] isEqual:@"admin"]||![_journal[@"storeId"] isEqual:store]))CRFail();
  _generation=CRRandom(16);
  _journal=@{@"version":@1,@"lifecycle":@"active",@"outcome":@"pending",@"generation":_generation,@"bootId":_boot,
    @"installationId":_installation[@"installationId"],@"storeId":store,@"role":@"metadata",@"operation":operation,@"nonceHash":CRRandom(32)};
  NSString *file=[_root stringByAppendingPathComponent:@"owner.json"];CRAtomicJSON(file,_journal);_journalPin=CRPrivatePin(file,NO);
}
- (void)beginModelCleanup {
  [self assertHeld];
  if(![_installation[@"setup"] isEqual:@"ready"]||_installation[@"pendingRestore"]!=[NSNull null]||
     ![_journal[@"lifecycle"] isEqual:@"quiescent"]||[_journal[@"outcome"] isEqual:@"uncertain"])CRFail();
  _generation=CRRandom(16);
  _journal=@{@"version":@1,@"lifecycle":@"active",@"outcome":@"pending",@"generation":_generation,@"bootId":_boot,
    @"installationId":_installation[@"installationId"],@"storeId":_installation[@"selectedStore"],@"role":@"metadata",@"operation":@"cleanup-downloads",@"nonceHash":CRRandom(32)};
  NSString *file=[_root stringByAppendingPathComponent:@"owner.json"];CRAtomicJSON(file,_journal);_journalPin=CRPrivatePin(file,NO);
}
- (void)finishOutcome:(NSString *)outcome {
  [self assertHeld];
  if (![@[@"ok", @"failed", @"uncertain"] containsObject:outcome] || !_journal || ![_journal[@"lifecycle"] isEqual:@"active"]) CRFail();
  // Caller separately proves direct exits and required application drain. This is
  // additional holder-extinction proof, never a substitute for those observations.
  close(_lockFD); _lockFD = -1;
  _poisoned = YES;
  NSString *lock = [_root stringByAppendingPathComponent:@"owner.lock"];
  int next = open(lock.fileSystemRepresentation, O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (next < 0) CRFail();
  // A rejected new launcher can briefly hold a separate lock description here.
  // Success still proves extinction of the inherited description; elapsed time
  // alone never does. All original metadata/inode pins are checked afterward.
  double deadline=CRLifecycleNow()+0.250;
  while(flock(next,LOCK_EX|LOCK_NB)){
    int error=errno;
    if((error!=EWOULDBLOCK&&error!=EAGAIN&&error!=EINTR)||CRLifecycleNow()>=deadline){close(next);CRFail();}
    usleep(1000);
  }
  _lockFD = next; _poisoned = NO;
  @try { [self assertHeld]; }
  @catch (NSException *exception) { _poisoned = YES; close(_lockFD); _lockFD = -1; @throw exception; }
  NSMutableDictionary *quiet = [_journal mutableCopy]; quiet[@"lifecycle"] = @"quiescent"; quiet[@"outcome"] = outcome;
  NSString *file = [_root stringByAppendingPathComponent:@"owner.json"];
  CRAtomicJSON(file, quiet); _journal = quiet; _journalPin = CRPrivatePin(file, NO);
}
@end
