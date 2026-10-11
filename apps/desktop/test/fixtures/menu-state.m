#import "menu.m"
#include <stdio.h>
@interface CRMenu (FixtureVisible)
- (void)beginRestart;
@end
@interface FixtureMenu : CRMenu
@property(nonatomic,strong) NSMutableArray *captured;
@end
@implementation FixtureMenu
- (void)send:(NSString *)command {[_captured addObject:command];}
- (void)openDashboard:(id)sender {(void)sender;}
@end
static void record(CRMenu *menu,NSString *generation,NSString *type,NSDictionary *extra){NSMutableDictionary *value=[@{@"version":@1,@"generation":generation,@"type":type} mutableCopy];[value addEntriesFromDictionary:extra];[menu record:value];}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]],*one=@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",*two=@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  FixtureMenu *menu=[[FixtureMenu alloc] initWithBundle:@"fixture" root:root];menu.captured=[NSMutableArray array];
  NSString *(^unlock)(NSString *)=^NSString *(NSString *generation){return [[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation] stringByAppendingPathComponent:@"unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token"];};
  NSDictionary *(^ready)(NSString *)=^NSDictionary *(NSString *generation){return @{@"origin":@"http://127.0.0.1:3210",@"mcpOrigin":@"http://127.0.0.1:3211/mcp",@"modelEnabled":@NO,@"unlockFile":unlock(generation)};};
  [menu sleepWake:nil];record(menu,one,@"starting",@{@"phase":@"preparing"});record(menu,one,@"ready",ready(one));
  BOOL initial=[menu.captured containsObject:@"model-unavailable"];[menu.captured removeAllObjects];
  record(menu,one,@"model-status",@{@"state":@"busy"});
  record(menu,one,@"download-starting",@{});[menu cancelDownload:nil];[menu cancelDownload:nil];BOOL once=menu.captured.count==1&&[menu.captured[0] isEqual:@"cancel-download"];
  [menu.captured removeAllObjects];[menu beginRestart];[menu sleepWake:nil];record(menu,one,@"stopped",@{@"outcome":@"ok"});record(menu,two,@"starting",@{@"phase":@"preparing"});record(menu,two,@"ready",ready(two));BOOL restart=[menu.captured containsObject:@"model-unavailable"];
  printf("{\"initialSleep\":%s,\"restartSleep\":%s,\"cancelOnce\":%s}\n",initial?"true":"false",restart?"true":"false",once?"true":"false");return initial&&restart&&once?0:2;
}@catch(NSException *e){(void)e;return 1;}}}
