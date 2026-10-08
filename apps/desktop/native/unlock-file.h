#ifndef CR_UNLOCK_FILE_H
#define CR_UNLOCK_FILE_H
#import "envelope.h"
#include <errno.h>
#include <sys/stat.h>
#include <unistd.h>

// Only the validated ephemeral token leaf may disappear on expiry/reissue/close.
// Callers validate its exact export path and basename before this availability check.
static inline BOOL CRUnlockFileAvailable(NSString *file) {
  NSString *parent=file.stringByDeletingLastPathComponent;
  NSDictionary *before=CRPrivatePin(parent,YES);struct stat info;
  BOOL present=lstat(file.fileSystemRepresentation,&info)==0;
  if(!present&&errno!=ENOENT)CRFail();
  // A canonical parent plus a regular, single-link leaf excludes path indirection.
  // Do not realpath the ephemeral leaf: it can legitimately vanish after lstat.
  if(present&&(info.st_uid!=getuid()||(info.st_mode&07777)!=0600||!S_ISREG(info.st_mode)||info.st_nlink!=1))CRFail();
  if(![CRPrivatePin(parent,YES) isEqual:before])CRFail();
  return present;
}
#endif
