#import "package.h"
#import <CommonCrypto/CommonDigest.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <limits.h>
#include <unistd.h>

void CRFail(void) { @throw [NSException exceptionWithName:@"ManagedFailure" reason:@"Managed command unavailable" userInfo:nil]; }
BOOL CRExact(id v, NSArray<NSString *> *keys) {
  if (![v isKindOfClass:[NSDictionary class]] || [v count] != keys.count) return NO;
  for (NSString *key in keys) if (!v[key]) return NO;
  return YES;
}
BOOL CRInteger(id value, long long minimum, long long maximum) {
  return [value isKindOfClass:[NSNumber class]] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() &&
    isfinite([value doubleValue]) && [value doubleValue] == [value longLongValue] && [value longLongValue] >= minimum && [value longLongValue] <= maximum;
}
BOOL CRPattern(id value, NSString *pattern) {
  if (![value isKindOfClass:[NSString class]]) return NO;
  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
  NSTextCheckingResult *match = [regex firstMatchInString:value options:0 range:NSMakeRange(0, [value length])];
  return match && NSEqualRanges(match.range, NSMakeRange(0, [value length]));
}
static BOOL stable(struct stat a, struct stat b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_mode == b.st_mode && a.st_nlink == b.st_nlink &&
    a.st_size == b.st_size && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}
static NSString *hex(const unsigned char *bytes, NSUInteger count) {
  NSMutableString *result = [NSMutableString stringWithCapacity:count * 2];
  for (NSUInteger i = 0; i < count; i++) [result appendFormat:@"%02x", bytes[i]];
  return result;
}
NSString *CRSHA256(NSData *bytes) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  if (bytes.length > UINT_MAX) CRFail();
  CC_SHA256(bytes.bytes, (CC_LONG)bytes.length, digest);
  return hex(digest, sizeof(digest));
}
NSData *CRReadData(NSString *file, NSUInteger maximum, BOOL privateFile) {
  struct stat before, opened, after;
  if (lstat(file.fileSystemRepresentation, &before) || !S_ISREG(before.st_mode) || before.st_nlink != 1 || before.st_size < 1 ||
      (unsigned long long)before.st_size > maximum || (before.st_mode & 0022) ||
      (privateFile && (before.st_uid != getuid() || (before.st_mode & 07777) != 0600))) CRFail();
  int fd = open(file.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) CRFail();
  NSMutableData *bytes = [NSMutableData dataWithLength:(NSUInteger)before.st_size];
  BOOL okay = !fstat(fd, &opened) && stable(before, opened);
  NSUInteger offset = 0;
  while (okay && offset < bytes.length) {
    ssize_t n = read(fd, (char *)bytes.mutableBytes + offset, bytes.length - offset);
    if (n <= 0) { okay = NO; break; } offset += (NSUInteger)n;
  }
  okay = okay && !fstat(fd, &after) && stable(before, after) && !lstat(file.fileSystemRepresentation, &after) && stable(before, after);
  close(fd);
  if (!okay) CRFail();
  return bytes;
}
NSDictionary *CRReadJSON(NSString *file, NSUInteger maximum, BOOL privateFile) {
  NSData *bytes=CRReadData(file,maximum,privateFile);
  id value = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
  if (![value isKindOfClass:[NSDictionary class]]) CRFail();
  return value;
}
NSString *CRBundleRoot(void) {
  char executable[PATH_MAX], resolved[PATH_MAX]; uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) || !realpath(executable, resolved)) CRFail();
  NSString *file = [NSString stringWithUTF8String:resolved];
  if (![file.lastPathComponent isEqual:@"context-router"] || ![file.stringByDeletingLastPathComponent.lastPathComponent isEqual:@"MacOS"] ||
      ![file.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.lastPathComponent isEqual:@"Contents"]) CRFail();
  return file.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
}
static BOOL relative(NSString *name) {
  if (![name isKindOfClass:[NSString class]] || name.length > 4096 || ![name hasPrefix:@"Contents/"] ||
      [name containsString:@"\\"] || [name rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location != NSNotFound ||
      [name isEqual:@"Contents/Resources/package-manifest.json"]) return NO;
  for (NSString *part in [name componentsSeparatedByString:@"/"]) if (!part.length || [part isEqual:@"."] || [part isEqual:@".."]) return NO;
  return YES;
}
static NSString *fileHash(NSString *file, struct stat before) {
  int fd = open(file.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) CRFail();
  struct stat after; BOOL okay = !fstat(fd, &after) && stable(before, after);
  CC_SHA256_CTX context; CC_SHA256_Init(&context);
  unsigned char block[262144], digest[CC_SHA256_DIGEST_LENGTH]; off_t total = 0;
  while (okay && total < before.st_size) {
    ssize_t n = read(fd, block, (size_t)MIN((off_t)sizeof(block), before.st_size - total));
    if (n <= 0) { okay = NO; break; }
    CC_SHA256_Update(&context, block, (CC_LONG)n); total += n;
  }
  okay = okay && !fstat(fd, &after) && stable(before, after) && !lstat(file.fileSystemRepresentation, &after) && stable(before, after);
  close(fd); if (!okay) CRFail();
  CC_SHA256_Final(digest, &context); return hex(digest, sizeof(digest));
}
static void visit(NSString *root, NSString *name, NSDictionary *expected, NSMutableSet *seen, unsigned long long *total) {
  NSString *file = name.length ? [root stringByAppendingPathComponent:name] : root;
  struct stat before, after;
  if (lstat(file.fileSystemRepresentation, &before)) CRFail();
  if ([name isEqual:@"Contents/Resources/package-manifest.json"]) return;
  if (S_ISDIR(before.st_mode)) {
    if (before.st_mode & 0022) CRFail();
    NSArray *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:file error:nil];
    if (!entries || entries.count > 100000) CRFail();
    for (NSString *child in entries) visit(root, name.length ? [name stringByAppendingPathComponent:child] : child, expected, seen, total);
    if (lstat(file.fileSystemRepresentation, &after) || !stable(before, after)) CRFail();
    return;
  }
  NSDictionary *entry = expected[name];
  if (!relative(name) || !entry || [seen containsObject:name]) CRFail();
  [seen addObject:name];
  if (S_ISLNK(before.st_mode)) {
    char target[PATH_MAX + 1], resolved[PATH_MAX];
    ssize_t n = readlink(file.fileSystemRepresentation, target, PATH_MAX);
    if (n < 1 || n >= PATH_MAX || !realpath(file.fileSystemRepresentation, resolved)) CRFail();
    target[n] = 0;
    NSString *link = [NSString stringWithUTF8String:target], *canonical = [NSString stringWithUTF8String:resolved];
    if (!CRExact(entry, @[@"path", @"kind", @"target"]) || ![entry[@"kind"] isEqual:@"symlink"] || !link || link.isAbsolutePath ||
        ![entry[@"target"] isEqual:link] || ![canonical hasPrefix:[root stringByAppendingString:@"/"]] ||
        lstat(file.fileSystemRepresentation, &after) || !stable(before, after)) CRFail();
  } else {
    if (!S_ISREG(before.st_mode) || before.st_nlink != 1 || (before.st_mode & 0022) || before.st_size < 0 ||
        !CRExact(entry, @[@"path", @"kind", @"size", @"sha256", @"executable"]) || ![entry[@"kind"] isEqual:@"file"] ||
        !CRInteger(entry[@"size"], 0, 2147483648LL) || [entry[@"size"] longLongValue] != before.st_size ||
        !CRPattern(entry[@"sha256"], @"[a-f0-9]{64}") || CFGetTypeID((__bridge CFTypeRef)entry[@"executable"]) != CFBooleanGetTypeID() ||
        [entry[@"executable"] boolValue] != !!(before.st_mode & 0111)) CRFail();
    *total += (unsigned long long)before.st_size;
    if (*total > 2147483648ULL || ![fileHash(file, before) isEqual:entry[@"sha256"]]) CRFail();
  }
}
NSDictionary *CRVerifyPackage(NSString *root) {
#if !defined(__arm64__)
  CRFail();
#endif
  NSDictionary *m = CRReadJSON([root stringByAppendingPathComponent:@"Contents/Resources/package-manifest.json"], 32 * 1024 * 1024, NO);
  if (!CRExact(m, @[@"version", @"distribution", @"platform", @"arch", @"securityEpoch", @"node", @"sqliteVersions", @"identityVersion", @"model", @"source", @"files"]) ||
      !CRInteger(m[@"version"], 1, 1) || ![m[@"distribution"] isEqual:@"local-candidate"] || ![m[@"platform"] isEqual:@"darwin"] ||
      ![m[@"arch"] isEqual:@"arm64"] || !CRInteger(m[@"securityEpoch"], 1, 1) || ![m[@"node"] isEqual:@"24.21.0"] ||
      ![m[@"sqliteVersions"] isEqual:@[@1, @2]] || !CRInteger(m[@"identityVersion"], 1, 1) || !CRPattern(m[@"source"], @"[a-f0-9]{64}") ||
      ![m[@"files"] isKindOfClass:[NSArray class]] || ![m[@"files"] count] || [m[@"files"] count] > 100000) CRFail();
  NSDictionary *model = m[@"model"];
  if (!CRExact(model, @[@"name", @"bytes", @"sha256", @"url", @"runtime", @"runtimeArchiveSha256", @"contextTokens", @"slots"]) ||
      ![model[@"name"] isEqual:@"Qwen3.5-9B-Q4_K_M.gguf"] || !CRInteger(model[@"bytes"], 5680522464LL, 5680522464LL) ||
      ![model[@"sha256"] isEqual:@"03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8"] ||
      ![model[@"url"] isEqual:@"https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf"] ||
      ![model[@"runtime"] isEqual:@"b11146"] || ![model[@"runtimeArchiveSha256"] isEqual:@"1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711"] ||
      !CRInteger(model[@"contextTokens"], 16384, 16384) || !CRInteger(model[@"slots"], 1, 1)) CRFail();
  NSMutableDictionary *expected = [NSMutableDictionary dictionary]; NSString *previous = @"";
  for (id entry in m[@"files"]) {
    if (![entry isKindOfClass:[NSDictionary class]] || !relative(entry[@"path"]) || [previous compare:entry[@"path"] options:NSLiteralSearch] != NSOrderedAscending) CRFail();
    previous = entry[@"path"]; expected[previous] = entry;
  }
  for (NSString *name in @[@"Contents/MacOS/context-router", @"Contents/Resources/bin/node", @"Contents/Resources/model/llama-server",
      @"Contents/Resources/app/local-ui.mjs", @"Contents/Resources/desktop/runtime/prepare.mjs", @"Contents/Resources/desktop/runtime/application.mjs",
      @"Contents/Resources/desktop/runtime/maintenance.mjs", @"Contents/Resources/desktop/runtime/prepare-store.mjs", @"Contents/Resources/desktop/runtime/download.mjs"])
    if (!expected[name] || ![expected[name][@"kind"] isEqual:@"file"]) CRFail();
  NSMutableSet *seen = [NSMutableSet set]; unsigned long long total = 0;
  visit(root, @"", expected, seen, &total);
  if (seen.count != expected.count) CRFail();
  return m;
}
