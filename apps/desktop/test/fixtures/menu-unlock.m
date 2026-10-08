#import "menu.m"
#include <objc/runtime.h>
#include <unistd.h>
#include <sys/stat.h>
static NSUInteger alerts=0;
static id unavailableAlert(id self,SEL selector){(void)self;(void)selector;alerts++;CRFail();return nil;}
@interface UnlockMenu : CRMenu
@property(nonatomic,strong) NSMutableArray *captured;
@property(nonatomic) NSUInteger reads;
@end
@implementation UnlockMenu
- (void)send:(NSString *)command {[_captured addObject:command];}
- (void)openDashboard:(id)sender {(void)sender;}
- (NSString *)code {self.reads++;if([[self valueForKey:@"stopping"] boolValue]||[[self valueForKey:@"quitting"] boolValue])CRFail();return [super code];}
@end
static void record(CRMenu *menu,NSString *type,NSDictionary *extra){NSMutableDictionary *value=[@{@"version":@1,@"generation":@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"type":type} mutableCopy];[value addEntriesFromDictionary:extra];[menu record:value];}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]],*exports=[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],*file=[exports stringByAppendingPathComponent:@"unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token"];
  UnlockMenu *menu=[[UnlockMenu alloc] initWithBundle:@"fixture" root:root];menu.captured=[NSMutableArray array];
  NSDictionary *delivery=@{@"origin":@"http://127.0.0.1:3210",@"unlockFile":file};NSMutableDictionary *ready=[delivery mutableCopy];ready[@"mcpOrigin"]=@"http://127.0.0.1:3211/mcp";ready[@"modelEnabled"]=@NO;
  record(menu,@"starting",@{@"phase":@"preparing"});record(menu,@"ready",ready);
  if(![[menu valueForKey:@"ready"] boolValue]||[menu valueForKey:@"unlockFile"])CRFail();
  [menu newUnlock:nil];if(![menu.captured isEqual:@[@"unlock"]])CRFail();
  NSString *token=@"cr_ui_unlock_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n";
  if(![token writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil]||chmod(file.fileSystemRepresentation,0600))CRFail();
  record(menu,@"unlock",delivery);if(![[menu code] isEqual:[token substringToIndex:token.length-1]])CRFail();
  if(unlink(file.fileSystemRepresentation))CRFail();record(menu,@"unlock",delivery);
  if(![[menu valueForKey:@"ready"] boolValue]||[menu valueForKey:@"unlockFile"])CRFail();
  [menu newUnlock:nil];if(menu.captured.count!=2)CRFail();
  // Expiry after record delivery is handled by the actual code reader/copy path.
  if(![token writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil]||chmod(file.fileSystemRepresentation,0600))CRFail();record(menu,@"unlock",delivery);if(unlink(file.fileSystemRepresentation))CRFail();[menu copyUnlock:nil];
  if(![[menu valueForKey:@"ready"] boolValue]||[menu valueForKey:@"unlockFile"])CRFail();
  if(!class_addMethod(object_getClass([NSAlert class]),@selector(new),(IMP)unavailableAlert,"@@:"))CRFail();
  [menu setValue:@YES forKey:@"stopping"];if(rmdir(exports.fileSystemRepresentation))CRFail();NSUInteger before=menu.reads;
  record(menu,@"unlock",delivery);[menu showUnlock];[menu copyUnlock:nil];if(menu.reads!=before||alerts)CRFail();
  BOOL refused=NO;@try{record(menu,@"unlock",@{@"origin":@"http://127.0.0.1:3210",@"unlockFile":@"/tmp/wrong.token"});}@catch(NSException *e){(void)e;refused=YES;}if(!refused)CRFail();
  UnlockMenu *quitting=[[UnlockMenu alloc] initWithBundle:@"fixture" root:root];quitting.captured=[NSMutableArray array];record(quitting,@"starting",@{@"phase":@"preparing"});[quitting setValue:@YES forKey:@"quitting"];[quitting setValue:@YES forKey:@"stopping"];record(quitting,@"ready",ready);[quitting showUnlock];[quitting copyUnlock:nil];if(quitting.reads||alerts||![quitting.captured containsObject:@"quit"])CRFail();
  puts("missing-token-ready-and-shutdown-safe");return 0;
}@catch(NSException *e){(void)e;return 1;}}}
