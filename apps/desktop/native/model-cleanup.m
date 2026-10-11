#import "model-cleanup.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
static NSString *const modelName=@"Qwen3.5-9B-Q4_K_M.gguf";
static NSDictionary *fileSnapshot(NSString *file){
  struct stat s;
  if(lstat(file.fileSystemRepresentation,&s)||!S_ISREG(s.st_mode)||s.st_uid!=getuid()||(s.st_mode&07777)!=0600||
     (s.st_nlink!=1&&s.st_nlink!=2)||s.st_size<0||s.st_size>5680522464LL)CRFail();
  return @{@"dev":@(s.st_dev),@"ino":@(s.st_ino),@"links":@(s.st_nlink),@"size":@(s.st_size),
    @"mtime":@[@(s.st_mtimespec.tv_sec),@(s.st_mtimespec.tv_nsec)],@"ctime":@[@(s.st_ctimespec.tv_sec),@(s.st_ctimespec.tv_nsec)]};
}
static BOOL sameFile(NSDictionary *a,NSDictionary *b){return [a[@"dev"] isEqual:b[@"dev"]]&&[a[@"ino"] isEqual:b[@"ino"]];}
NSDictionary *CRPlanModelCleanup(CREnvelope *owner){
  [owner assertHeld];
  if(![owner.installation[@"setup"] isEqual:@"ready"]||owner.installation[@"pendingRestore"]!=[NSNull null])CRFail();
  NSString *directory=[owner.root stringByAppendingPathComponent:@"models"];
  NSDictionary *pin=CRPrivatePin(directory,YES);
  NSArray *names=[[NSFileManager defaultManager] contentsOfDirectoryAtPath:directory error:nil];
  if(!names||names.count>1024)CRFail();NSMutableDictionary *files=[NSMutableDictionary dictionary];
  for(NSString *name in names){
    if(![name isEqual:modelName]&&!CRPattern(name,@"\\.download-[a-f0-9]{32}-[a-f0-9]{32}\\.part"))CRFail();
    files[name]=fileSnapshot([directory stringByAppendingPathComponent:name]);
  }
  NSDictionary *model=files[modelName];if(model&&[model[@"size"] longLongValue]!=5680522464LL)CRFail();
  NSUInteger pairs=0;
  for(NSString *name in files)if(![name isEqual:modelName]&&[files[name][@"links"] intValue]==2){
    if(!model||![files[name] isEqual:model])CRFail();pairs++;
  }
  if(model&&[model[@"links"] intValue]==2&&pairs!=1)CRFail();
  if(![CRPrivatePin(directory,YES) isEqual:pin])CRFail();[owner assertHeld];
  return @{@"directory":directory,@"pin":pin,@"files":files};
}
void CRApplyModelCleanup(CREnvelope *owner,NSDictionary *plan){
  // Preflight all entries again after journal publication, before the first unlink.
  if(![CRPlanModelCleanup(owner) isEqual:plan])CRFail();
  NSString *directory=plan[@"directory"];NSDictionary *files=plan[@"files"];
  int fd=open(directory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)CRFail();
  @try{
    for(NSString *name in [[files allKeys] sortedArrayUsingSelector:@selector(compare:)]){
      if([name isEqual:modelName])continue;
      [owner assertHeld];struct stat held;
      if(fstat(fd,&held)||![plan[@"pin"] isEqual:@{@"dev":@(held.st_dev),@"ino":@(held.st_ino)}]||![CRPrivatePin(directory,YES) isEqual:plan[@"pin"]])CRFail();
      NSDictionary *before=files[name];if(![fileSnapshot([directory stringByAppendingPathComponent:name]) isEqual:before])CRFail();
      BOOL paired=[before[@"links"] intValue]==2;
      if(paired&&![fileSnapshot([directory stringByAppendingPathComponent:modelName]) isEqual:files[modelName]])CRFail();
      if(unlinkat(fd,name.fileSystemRepresentation,0)||fsync(fd))CRFail();
      if(paired){NSDictionary *after=fileSnapshot([directory stringByAppendingPathComponent:modelName]);
        if(!sameFile(after,before)||[after[@"links"] intValue]!=1||![after[@"size"] isEqual:before[@"size"]])CRFail();}
    }
    if(fsync(fd))CRFail();[owner assertHeld];
  }@finally{close(fd);}
}
