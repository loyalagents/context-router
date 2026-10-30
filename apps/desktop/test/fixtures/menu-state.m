#import "menu.m"
#include <stdio.h>
@interface CRMenu (FixtureVisible)
- (void)beginRestart;
- (void)beginModeChange:(NSString *)command;
@end
@interface FixtureMenu : CRMenu
@property(nonatomic,strong) NSMutableArray *captured;
@end
@implementation FixtureMenu
- (void)send:(NSString *)command {[_captured addObject:command];}
- (void)openDashboard:(id)sender {(void)sender;}
@end
// Observe presentation without registering a status item in the user's menu bar.
@interface FixtureStatusButton : NSObject
@property(nonatomic,copy) NSString *title,*toolTip,*accessibilityLabel;
@end
@implementation FixtureStatusButton
@end
@interface FixtureStatusItem : NSObject
@property(nonatomic,strong) FixtureStatusButton *button;
@property(nonatomic) CGFloat length;
@end
@implementation FixtureStatusItem
@end
@interface FixtureGuardian : NSObject
@property(nonatomic,getter=isRunning) BOOL running;
@end
@implementation FixtureGuardian
@end
static void record(CRMenu *menu,NSString *generation,NSString *type,NSDictionary *extra){NSMutableDictionary *value=[@{@"version":@1,@"generation":generation,@"type":type} mutableCopy];[value addEntriesFromDictionary:extra];[menu record:value];}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=2)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]],*one=@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",*two=@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  FixtureMenu *menu=[[FixtureMenu alloc] initWithBundle:@"fixture" root:root];menu.captured=[NSMutableArray array];
  NSString *(^unlock)(NSString *)=^NSString *(NSString *generation){return [[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation] stringByAppendingPathComponent:@"unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token"];};
  NSDictionary *(^ready)(NSString *)=^NSDictionary *(NSString *generation){return @{@"origin":@"http://127.0.0.1:3210",@"mcpOrigin":@"http://127.0.0.1:3211/mcp",@"modelEnabled":@NO,@"unlockFile":unlock(generation)};};
  FixtureMenu *modeMenu=[[FixtureMenu alloc] initWithBundle:@"fixture" root:root];modeMenu.captured=[NSMutableArray array];
  NSMenuItem *modeLabel=[NSMenuItem new];[modeMenu setValue:modeLabel forKey:@"label"];
  FixtureGuardian *guardian=[FixtureGuardian new];guardian.running=YES;[modeMenu setValue:guardian forKey:@"guardian"];
  NSMutableDictionary *items=[modeMenu valueForKey:@"items"];items[@"download"]=[NSMenuItem new];items[@"model-setup"]=[NSMenuItem new];
  FixtureStatusItem *status=[FixtureStatusItem new];status.button=[FixtureStatusButton new];status.button.title=@"CR";status.length=NSVariableStatusItemLength;[modeMenu setValue:status forKey:@"status"];
  [modeMenu update];BOOL neutral=[status.button.toolTip isEqual:@"Context Router"]&&[status.button.accessibilityLabel isEqual:@"Context Router"];
  if([items[@"download"] isEnabled]||![items[@"model-setup"] isEnabled])return 14;
  NSMutableArray *titles=[NSMutableArray array],*tooltips=[NSMutableArray array],*accessible=[NSMutableArray array],*lengths=[NSMutableArray array];
  NSArray *modes=@[@"personal",@"demo",@"personal"],*generations=@[one,two,one];
  for(NSUInteger i=0;i<modes.count;i++){
    if(i)record(modeMenu,generations[i-1],@"stopped",@{@"outcome":@"ok"});
    record(modeMenu,generations[i],@"starting",@{@"phase":@"preparing"});[modeMenu update];if(!i)neutral=neutral&&[status.button.toolTip isEqual:@"Context Router"]&&[status.button.accessibilityLabel isEqual:@"Context Router"];
    record(modeMenu,generations[i],@"mode",@{@"mode":modes[i],@"storeId":one});record(modeMenu,generations[i],@"ready",ready(generations[i]));[modeMenu update];
    BOOL demo=[modes[i] isEqual:@"demo"];
    if([items[@"download"] isEnabled]==demo||![items[@"model-setup"] isEnabled])return 15;
    if(![[items[@"download"] title] isEqual:demo?@"Download model — personal mode only":@"Download Qwen3.5 9B model…"])return 16;
    if(demo&&![[items[@"download"] toolTip] containsString:@"Model setup and location"])return 17;
    if(!demo&&[items[@"download"] toolTip]!=nil)return 18;
    if([modes[i] isEqual:@"demo"]){
      if(![modeLabel.title isEqual:@"Demo ready · AI not enabled"])return 9;
      NSDictionary *labels=@{@"loading":@"AI loading",@"available":@"AI available",@"busy":@"AI working",@"unavailable":@"restart required for AI"};
      for(NSString *state in labels){record(modeMenu,generations[i],@"model-status",@{@"state":state});if(![modeLabel.title isEqual:[@"Demo ready · " stringByAppendingString:labels[state]]])return 10;}
      [modeMenu sleepWake:nil];if(![modeLabel.title isEqual:@"Demo ready · restart required after sleep"])return 11;
      [modeMenu.captured removeAllObjects];[modeMenu beginModeChange:@"leave-demo"];
      if([[modeMenu valueForKey:@"sleepInvalidated"] boolValue]||![modeMenu.captured isEqual:@[@"leave-demo"]])return 12;
    }
    if(i==2&&[modeMenu.captured containsObject:@"model-unavailable"])return 13;
    [titles addObject:status.button.title?:@""];[tooltips addObject:status.button.toolTip?:@""];[accessible addObject:status.button.accessibilityLabel?:@""];[lengths addObject:@(status.length)];
  }
  if(![titles isEqual:@[@"CR",@"CR",@"CR"]]||![lengths isEqual:@[@(NSVariableStatusItemLength),@(NSVariableStatusItemLength),@(NSVariableStatusItemLength)]]){fputs("Status title and width policy must remain compact across admitted modes\n",stderr);return 7;}
  NSArray *descriptions=@[@"Context Router — Personal mode",@"Context Router — Demo mode · historical sample",@"Context Router — Personal mode"];
  if(!neutral||![tooltips isEqual:descriptions]||![accessible isEqual:descriptions]){fputs("Status descriptions must stay neutral until admission, then identify the mode\n",stderr);return 8;}
  [menu sleepWake:nil];record(menu,one,@"starting",@{@"phase":@"preparing"});record(menu,one,@"ready",ready(one));
  BOOL initial=[menu.captured containsObject:@"model-unavailable"];[menu.captured removeAllObjects];
  record(menu,one,@"model-status",@{@"state":@"busy"});
  record(menu,one,@"download-starting",@{});[menu cancelDownload:nil];[menu cancelDownload:nil];BOOL once=menu.captured.count==1&&[menu.captured[0] isEqual:@"cancel-download"];
  [menu.captured removeAllObjects];[menu beginRestart];[menu sleepWake:nil];record(menu,one,@"stopped",@{@"outcome":@"ok"});record(menu,two,@"starting",@{@"phase":@"preparing"});record(menu,two,@"ready",ready(two));BOOL restart=[menu.captured containsObject:@"model-unavailable"];
  [menu setValue:@"demo" forKey:@"mode"];[menu setValue:one forKey:@"storeId"];
  NSString *commands=[[menu demoSetupCommands] componentsJoinedByString:@"\n"];
  BOOL setup=[commands containsString:@"login B --client claude --auth subscription"]&&[commands containsString:@"launch B --client claude --auth subscription"]&&[commands containsString:@"--generation 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'"]&&[commands containsString:@"--endpoint 'http://127.0.0.1:3211/mcp'"]&&[commands containsString:@"login A"]&&[commands containsString:@"desktop prepare"];
  if(!setup)return 3;
  if([menu demoSetupCommands].count!=6)return 4;
  record(menu,two,@"stopped",@{@"outcome":@"failed"});record(menu,one,@"starting",@{@"phase":@"demo-unavailable"});record(menu,one,@"mode",@{@"mode":@"demo",@"storeId":two});
  if(![[menu valueForKey:@"demoUnavailable"] boolValue]||[[menu valueForKey:@"ready"] boolValue])return 5;
  record(menu,one,@"transition-refused",@{});if([[menu valueForKey:@"stopping"] boolValue])return 6;
  printf("{\"initialSleep\":%s,\"restartSleep\":%s,\"cancelOnce\":%s,\"compactModeLabel\":true}\n",initial?"true":"false",restart?"true":"false",once?"true":"false");return initial&&restart&&once?0:2;
}@catch(NSException *e){(void)e;return 1;}}}
