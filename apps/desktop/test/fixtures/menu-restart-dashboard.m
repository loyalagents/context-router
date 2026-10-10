#import "menu.m"
#include <stdio.h>

@interface RestartMenu : CRMenu
@property(nonatomic,strong) NSMutableArray *opened;
@property(nonatomic,strong) NSMutableArray *captured;
@end
@implementation RestartMenu
- (void)send:(NSString *)command {[_captured addObject:command];}
// Capture the browser boundary without opening or changing a real browser.
- (void)openDashboard:(id)sender {
  (void)sender;
  if(![[self valueForKey:@"ready"] boolValue]||[[self valueForKey:@"stopping"] boolValue]||[[self valueForKey:@"quitting"] boolValue]||[[self valueForKey:@"broken"] boolValue])CRFail();
  [_opened addObject:[self valueForKey:@"origin"]];
}
@end
static RestartMenu *menu(NSString *root) {
  RestartMenu *value=[[RestartMenu alloc] initWithBundle:@"fixture" root:root];
  value.opened=[NSMutableArray array];value.captured=[NSMutableArray array];return value;
}
static void record(RestartMenu *menu,NSString *generation,NSString *type,NSDictionary *extra) {
  NSMutableDictionary *value=[@{@"version":@1,@"generation":generation,@"type":type} mutableCopy];
  [value addEntriesFromDictionary:extra];[menu record:value];
}
static NSDictionary *ready(NSString *root,NSString *generation,NSString *origin) {
  return @{@"origin":origin,@"mcpOrigin":@"http://127.0.0.1:3211/mcp",@"modelEnabled":@NO,
    @"unlockFile":[[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation] stringByAppendingPathComponent:@"unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token"]};
}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]];
  NSArray *generations=@[@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",@"cccccccccccccccccccccccccccccccc"];
  NSArray *origins=@[@"http://127.0.0.1:3210",@"http://127.0.0.1:4210",@"http://127.0.0.1:5210"];
  RestartMenu *normal=menu(root);
  for(NSUInteger i=0;i<generations.count;i++){
    if(i){[normal beginRestart];if(normal.opened.count!=i)CRFail();record(normal,generations[i-1],@"stopped",@{@"outcome":@"ok"});}
    record(normal,generations[i],@"starting",@{@"phase":@"preparing"});if(normal.opened.count!=i)CRFail();
    record(normal,generations[i],@"ready",ready(root,generations[i],origins[i]));
    if(normal.opened.count!=i+1||![normal.opened.lastObject isEqual:origins[i]])CRFail();
    NSDictionary *delivery=ready(root,generations[i],origins[i]);record(normal,generations[i],@"unlock",@{@"origin":delivery[@"origin"],@"unlockFile":delivery[@"unlockFile"]});if(normal.opened.count!=i+1)CRFail();
    record(normal,generations[i],@"model-status",@{@"state":@"unavailable"});if(normal.opened.count!=i+1)CRFail();
  }
  if(![normal.captured isEqual:@[@"restart",@"restart"]])CRFail();
  // Failed replacement startup never opens a browser.
  [normal beginRestart];record(normal,generations[2],@"stopped",@{@"outcome":@"ok"});
  record(normal,generations[0],@"starting",@{@"phase":@"preparing"});record(normal,generations[0],@"stopped",@{@"outcome":@"failed"});
  if(normal.opened.count!=3)CRFail();
  for(NSString *flag in @[@"stopping",@"quitting",@"broken"]){
    RestartMenu *held=menu(root);record(held,generations[0],@"starting",@{@"phase":@"preparing"});record(held,generations[0],@"ready",ready(root,generations[0],origins[0]));
    [held beginRestart];record(held,generations[0],@"stopped",@{@"outcome":@"ok"});record(held,generations[1],@"starting",@{@"phase":@"preparing"});
    [held setValue:@YES forKey:flag];record(held,generations[1],@"ready",ready(root,generations[1],origins[1]));
    if(held.opened.count!=1)CRFail();if([flag isEqual:@"quitting"]&&![held.captured.lastObject isEqual:@"quit"])CRFail();
  }
  puts("dashboard-opens-on-ready-after-each-restart-only");return 0;
}@catch(NSException *e){(void)e;return 1;}}}
