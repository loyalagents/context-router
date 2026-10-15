#import "menu.m"
#include <stdio.h>
@interface FakeSetupOperation : NSObject
@property BOOL finished,success,cancelled,ownershipLost;
@property(strong) NSData *output,*errorOutput;
@property(strong) NSString *failure;
@property NSUInteger pumps,cancels;
- (void)pump;
- (void)cancel:(NSString *)reason;
@end
@implementation FakeSetupOperation
- (void)pump {self.pumps++;}
- (void)cancel:(NSString *)reason {self.cancels++;self.cancelled=YES;self.failure=reason;}
@end
@interface ControlGuardian : NSObject
@property(getter=isRunning) BOOL running;
@end
@implementation ControlGuardian
@end
@interface ControlMenu : CRMenu
@property(strong) NSUserDefaults *defaults;
@property(strong) NSString *choice;
@property(strong) NSMutableArray *arguments,*handoffs,*sent,*callbacks;
@property BOOL deferCallbacks;
@property BOOL allowUncertainQuit,reenterQuitConfirmation;
@property NSUInteger quitConfirmations;
@property(strong) FakeSetupOperation *operation;
@end
@implementation ControlMenu
- (NSUserDefaults *)demoDefaults{return self.defaults;}
- (NSString *)chooseDemoExecutable:(NSString *)vendor {(void)vendor;return self.choice;}
- (BOOL)confirmDemoProvider:(BOOL)login vendor:(NSString *)vendor {(void)login;(void)vendor;return YES;}
- (CRDemoOperation *)demoOperationWithArguments:(NSArray *)arguments {
 [self.arguments addObject:arguments];self.operation=[FakeSetupOperation new];self.operation.output=[NSData data];self.operation.errorOutput=[NSData data];return (CRDemoOperation *)self.operation;
}
- (void)openDemoTerminal:(NSString *)file completion:(void (^)(BOOL))completion {[self.handoffs addObject:file];if(self.deferCallbacks)[self.callbacks addObject:[completion copy]];else completion(YES);}
- (void)send:(NSString *)command {[self.sent addObject:command];}
- (void)completeDemoQuit {(void)[self applicationShouldTerminate:NSApp];}
- (BOOL)confirmUncertainDemoQuit {self.quitConfirmations++;if(self.reenterQuitConfirmation&&[self applicationShouldTerminate:NSApp]!=NSTerminateCancel)@throw [NSException exceptionWithName:@"Assertion" reason:@"Confirmation reentry must remain blocked" userInfo:nil];return self.allowUncertainQuit;}
@end
static NSView *findControl(NSView *view,NSString *identifier){if([view.identifier isEqual:identifier])return view;for(NSView *child in view.subviews){NSView *found=findControl(child,identifier);if(found)return found;}return nil;}
static NSButton *doneButton(NSView *view){if([view isKindOfClass:NSButton.class]&&[((NSButton *)view).title isEqual:@"Done"])return (NSButton *)view;for(NSView *child in view.subviews){NSButton *found=doneButton(child);if(found)return found;}return nil;}
static void expect(BOOL yes,NSString *message){if(!yes)@throw [NSException exceptionWithName:@"Assertion" reason:message userInfo:nil];}
static NSButton *button(NSAlert *panel,NSString *identifier){NSButton *b=(NSButton *)findControl(panel.accessoryView,identifier);expect([b isKindOfClass:NSButton.class],identifier);return b;}
static NSScrollView *findScroll(NSView *view){if([view isKindOfClass:NSScrollView.class])return (NSScrollView *)view;for(NSView *child in view.subviews){NSScrollView *found=findScroll(child);if(found)return found;}return nil;}
static void capture(NSWindow *window,NSString *name){
 NSString *directory=NSProcessInfo.processInfo.environment[@"CR_MENU_SETUP_EVIDENCE_DIR"];if(!directory)return;
 [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
 [window.contentView layoutSubtreeIfNeeded];[window.contentView setNeedsDisplay:YES];[window.contentView display];NSView *view=window.contentView;NSBitmapImageRep *bitmap=[view bitmapImageRepForCachingDisplayInRect:view.bounds];[view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
 expect([[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:[name stringByAppendingString:@".png"]] atomically:YES],@"Render retained");
 NSString *dimensions=[NSString stringWithFormat:@"window %@; screen visible %@\n",NSStringFromRect(window.frame),NSStringFromRect(window.screen.visibleFrame)];[dimensions writeToFile:[directory stringByAppendingPathComponent:[name stringByAppendingString:@".txt"]] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
static void finish(ControlMenu *menu,NSDictionary *result){menu.operation.success=YES;menu.operation.finished=YES;menu.operation.output=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];[menu pollDemoOperation:nil];}
static ControlMenu *freshMenu(NSString *root,NSString *domain){
 ControlMenu *menu=[[ControlMenu alloc] initWithBundle:[root stringByAppendingPathComponent:@"Example's.app"] root:root];menu.defaults=[[NSUserDefaults alloc] initWithSuiteName:domain];menu.arguments=[NSMutableArray array];menu.handoffs=[NSMutableArray array];menu.sent=[NSMutableArray array];menu.callbacks=[NSMutableArray array];
 ControlGuardian *guardian=[ControlGuardian new];guardian.running=YES;[menu setValue:guardian forKey:@"guardian"];[menu setValue:@YES forKey:@"ready"];[menu setValue:@"demo" forKey:@"mode"];[menu setValue:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" forKey:@"storeId"];[menu setValue:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" forKey:@"generation"];[menu setValue:@"http://127.0.0.1:3211/mcp" forKey:@"mcpOrigin"];[menu setValue:[NSMenuItem new] forKey:@"label"];return menu;
}
static NSString *feedback(NSAlert *panel){return ((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).stringValue;}
static NSDictionary *failureEnvelope(ControlMenu *menu,NSString *message){NSDictionary *request=[menu valueForKey:@"demoRequest"];return @{@"version":@1,@"status":@"failed",@"action":request[@"kind"],@"binding":request[@"binding"],@"message":message};}
static void failSetup(ControlMenu *menu,NSData *output,NSString *failure){menu.operation.finished=YES;menu.operation.success=NO;menu.operation.output=output;menu.operation.errorOutput=[@"private raw loader stderr" dataUsingEncoding:NSUTF8StringEncoding];menu.operation.failure=failure;[menu pollDemoOperation:nil];}
static NSData *jsonBytes(id value){return [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];}
static void desktopFeedback(NSString *root,NSString *domain,NSDictionary *proposal){
 ControlMenu *menu=freshMenu(root,domain);NSAlert *panel=[menu demoSetupAlert];
 for(NSString *message in @[@"Desktop entry collision; config unchanged.",@"This demo profile has an active or uncertain invocation. Retain its guard; do not delete it or reuse the profile.",@"Desktop config changed; prepare a new proposal."]){
  [button(panel,@"demo-desktop-prepare") performClick:nil];expect([menu.arguments.lastObject containsObject:@"--native-result"],@"Finite helper requests the safe result protocol");
  failSetup(menu,jsonBytes(failureEnvelope(menu,message)),nil);expect([feedback(panel) isEqual:message],@"Safe helper reason is visible");expect(((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).toolTip==nil,@"Raw stderr never becomes a tooltip");
 }
 for(NSString *kind in @[@"extra",@"action",@"binding",@"control",@"format",@"bytes",@"invalid-utf8",@"mixed"]){
  [button(panel,@"demo-desktop-prepare") performClick:nil];NSMutableDictionary *value=[failureEnvelope(menu,@"UNSAFE") mutableCopy];
  if([kind isEqual:@"extra"])value[@"extra"]=@1;if([kind isEqual:@"action"])value[@"action"]=@"apply";if([kind isEqual:@"binding"])value[@"binding"]=@{};
  if([kind isEqual:@"control"])value[@"message"]=@"UNSAFE\nline";if([kind isEqual:@"format"])value[@"message"]=@"UNSAFE\u202e";if([kind isEqual:@"bytes"])value[@"message"]=[@"é" stringByPaddingToLength:401 withString:@"é" startingAtIndex:0];
  NSMutableData *bytes=[jsonBytes(value) mutableCopy];if([kind isEqual:@"invalid-utf8"]){unsigned char bad=0xff;bytes=[NSMutableData dataWithBytes:&bad length:1];}if([kind isEqual:@"mixed"])[bytes appendData:[@"\nraw warning" dataUsingEncoding:NSUTF8StringEncoding]];
  failSetup(menu,bytes,nil);expect(![feedback(panel) containsString:@"UNSAFE"]&&![feedback(panel) containsString:@"private raw"],@"Malformed diagnostics use a safe fallback");
 }
 [button(panel,@"demo-desktop-prepare") performClick:nil];failSetup(menu,jsonBytes(failureEnvelope(menu,@"Desktop config changed; prepare a new proposal.")),@"Setup timed out; inspect retained state.");expect([feedback(panel) hasPrefix:@"Setup timed out"],@"Native lifecycle uncertainty takes precedence");
 ((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).toolTip=@"stale";[button(panel,@"demo-desktop-prepare") performClick:nil];expect(((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).toolTip==nil,@"New action clears old tooltip");finish(menu,proposal);expect(((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).toolTip==nil,@"Success clears old tooltip");
 [button(panel,@"demo-desktop-closed") performClick:nil];[button(panel,@"demo-desktop-apply") performClick:nil];failSetup(menu,[NSData data],nil);
 expect([feedback(panel) hasPrefix:@"Apply is not confirmed"]&&[feedback(panel) containsString:@"do not replay"],@"Unknown visible apply failure retains uncertainty guidance");
 for(NSString *kind in @[@"prepare",@"apply-success",@"apply-failure",@"apply-unknown",@"apply-malformed",@"apply-reopened"]){
  NSTimer *dismiss=[NSTimer timerWithTimeInterval:0.02 repeats:NO block:^(NSTimer *timer){(void)timer;NSView *content=NSApp.modalWindow.contentView;[(NSButton *)findControl(content,@"demo-desktop-prepare") performClick:nil];if(![kind isEqual:@"prepare"]){finish(menu,proposal);[(NSButton *)findControl(content,@"demo-desktop-closed") performClick:nil];[(NSButton *)findControl(content,@"demo-desktop-apply") performClick:nil];}[doneButton(content) performClick:nil];}];[NSRunLoop.mainRunLoop addTimer:dismiss forMode:NSModalPanelRunLoopMode];[menu demoSetup:nil];
  BOOL reopened=[kind isEqual:@"apply-reopened"];if(reopened){panel=[menu demoSetupAlert];expect([feedback(panel) containsString:@"finishing"],@"Reopened panel shows the pending operation");}
  if([kind isEqual:@"prepare"])finish(menu,proposal);
  else if([kind isEqual:@"apply-success"]||reopened)finish(menu,@{@"status":@"applied",@"backup":NSNull.null});
  else if([kind isEqual:@"apply-failure"])failSetup(menu,jsonBytes(failureEnvelope(menu,@"The reviewed proposal changed. Prepare and review a new proposal; no config has changed.")),nil);
  else if([kind isEqual:@"apply-unknown"])failSetup(menu,[NSData data],nil);
  else finish(menu,@{@"status":@"unexpected"});
  if(!reopened){expect([menu valueForKey:@"demoCopyFeedback"]==nil,@"Hidden completion does not write dismissed views");panel=[menu demoSetupAlert];}
  NSString *expected=[kind isEqual:@"prepare"]?@"Prepare again":([kind isEqual:@"apply-success"]||reopened)?@"Setup applied":[kind isEqual:@"apply-failure"]?@"reviewed proposal changed":[kind isEqual:@"apply-unknown"]?@"Apply is not confirmed":@"could not be verified";
  expect([feedback(panel) containsString:expected],@"Reopened panel retains the bound Desktop outcome");expect(![feedback(panel) containsString:@"original configuration backup is retained"],@"No nonexistent backup claim");
  if([kind isEqual:@"apply-unknown"])expect([feedback(panel) containsString:@"do not replay"],@"Unknown retained apply failure preserves no-replay guidance");
  expect([menu valueForKey:@"demoProposal"]==nil&&!button(panel,@"demo-desktop-apply").enabled&&button(panel,@"demo-desktop-closed").state==NSControlStateValueOff,@"Outcome never revives proposal or closed attestation");
 }
 [button(panel,@"demo-desktop-prepare") performClick:nil];expect([menu valueForKey:@"demoOutcome"]==nil,@"New Desktop work clears the old outcome");finish(menu,proposal);
 [menu setValue:@"cccccccccccccccccccccccccccccccc" forKey:@"generation"];panel=[menu demoSetupAlert];expect([menu valueForKey:@"demoOutcome"]==nil&&[feedback(panel) hasPrefix:@"Choose an action"],@"Changed binding clears prior outcome");
 [button(panel,@"demo-desktop-prepare") performClick:nil];[menu setValue:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" forKey:@"generation"];finish(menu,proposal);expect([menu valueForKey:@"demoOutcome"]==nil,@"Stale completion cannot cache an outcome");
}
static void runtimeOutcomePrecedence(NSString *root,NSString *domain){
 for(NSNumber *pending in @[@NO,@YES])for(NSNumber *stopped in @[@NO,@YES]){
  ControlMenu *menu=freshMenu(root,domain);NSAlert *panel=[menu demoSetupAlert];[button(panel,@"demo-desktop-prepare") performClick:nil];
  menu.operation.ownershipLost=!pending.boolValue;[menu setValue:pending forKey:@"demoQuitPending"];[menu update];
  NSMenuItem *label=[menu valueForKey:@"label"];expect([label.title hasPrefix:pending.boolValue?@"Quit pending":@"Setup ownership uncertain"],@"Setup status is visible while the runtime is active");
  if(stopped.boolValue){[menu record:@{@"version":@1,@"generation":[menu valueForKey:@"generation"],@"type":@"stopped",@"outcome":@"uncertain"}];[menu update];expect([label.title isEqual:@"Runtime stopped — state retained"],@"Stopped runtime outcome takes precedence over setup status");}
  else{[menu breakControl];expect([label.title isEqual:@"Runtime unavailable — state retained"],@"Broken runtime outcome takes precedence over setup status");}
  expect([menu valueForKey:@"demoOperation"]!=nil,@"Runtime feedback never releases the uncertain operation");[(NSTimer *)[menu valueForKey:@"demoOperationTimer"] invalidate];
 }
}
static void uncertainQuit(NSString *root,NSString *domain,BOOL pending){
 ControlMenu *menu=freshMenu(root,domain);
 NSTimer *dismiss=[NSTimer timerWithTimeInterval:0.02 repeats:NO block:^(NSTimer *timer){(void)timer;NSView *content=NSApp.modalWindow.contentView;[(NSButton *)findControl(content,@"demo-desktop-prepare") performClick:nil];[doneButton(content) performClick:nil];}];[NSRunLoop.mainRunLoop addTimer:dismiss forMode:NSModalPanelRunLoopMode];[menu demoSetup:nil];
 FakeSetupOperation *operation=menu.operation;NSTimer *poll=[menu valueForKey:@"demoOperationTimer"];NSDictionary *request=[menu valueForKey:@"demoRequest"];
 if(pending){expect([menu applicationShouldTerminate:NSApp]==NSTerminateCancel,@"Normal Quit initially waits");expect([((NSMenuItem *)[menu valueForKey:@"label"]).title containsString:@"Quit pending"],@"Closed-panel Quit remains visible");}
 operation.ownershipLost=YES;operation.failure=@"Ownership uncertain; retain state.";[menu pollDemoOperation:nil];
 expect(!poll.valid&&[menu valueForKey:@"demoOperationTimer"]==nil,@"Ownership loss stops the finite poll timer");
 NSUInteger pumps=operation.pumps,cancels=operation.cancels;[menu pollDemoOperation:nil];expect(operation.pumps==pumps,@"No further pump after ownership loss");
 expect(menu.quitConfirmations==(pending?1u:0u),@"Pending Quit offers one uncertainty confirmation");
 if(!pending)expect([menu applicationShouldTerminate:NSApp]==NSTerminateCancel,@"Uncertain Quit defaults to cancel");
 expect(menu.sent.count==0&&![[menu valueForKey:@"demoQuitPending"] boolValue],@"Declining uncertainty sends nothing and clears only pending Quit");
 [menu beginRestart];[menu enterDemo:nil];[menu leaveDemo:nil];[menu resetDemo:nil];expect(menu.sent.count==0,@"Uncertain operation keeps transition interlocks");
 menu.allowUncertainQuit=YES;menu.reenterQuitConfirmation=YES;expect([menu applicationShouldTerminate:NSApp]==NSTerminateLater,@"Explicit uncertain Quit waits for guardian");
 expect([menu.sent isEqual:@[@"quit"]],@"Explicit uncertain Quit sends one guardian Quit");
 expect([menu applicationShouldTerminate:NSApp]==NSTerminateLater&&menu.quitConfirmations==2&&menu.sent.count==1,@"Confirmed Quit reentry neither prompts nor sends again");
 expect([menu valueForKey:@"demoOperation"]==(id)operation&&[menu valueForKey:@"demoRequest"]==request&&!operation.finished&&operation.pumps==pumps&&operation.cancels==cancels,@"Unknown helper ownership remains retained without pump, cancel or settlement claim");
 ((ControlGuardian *)[menu valueForKey:@"guardian"]).running=NO;expect([menu applicationShouldTerminate:NSApp]==NSTerminateNow,@"Guardian completion permits confirmed uncertain Quit");
}
int main(int argc,const char **argv){@autoreleasepool{@try{
 if(argc!=2)return 2;NSString *root=[NSString stringWithUTF8String:argv[1]],*domain=[@"cr.fixture." stringByAppendingString:CRRandom(16)];
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
 ControlMenu *menu=[[ControlMenu alloc] initWithBundle:[root stringByAppendingPathComponent:@"Example's.app"] root:root];menu.defaults=[[NSUserDefaults alloc] initWithSuiteName:domain];menu.arguments=[NSMutableArray array];menu.handoffs=[NSMutableArray array];menu.sent=[NSMutableArray array];menu.callbacks=[NSMutableArray array];
 ControlGuardian *guardian=[ControlGuardian new];guardian.running=YES;[menu setValue:guardian forKey:@"guardian"];[menu setValue:@YES forKey:@"ready"];[menu setValue:@"demo" forKey:@"mode"];[menu setValue:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" forKey:@"storeId"];[menu setValue:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" forKey:@"generation"];[menu setValue:@"http://127.0.0.1:3211/mcp" forKey:@"mcpOrigin"];
 NSAlert *panel=[menu demoSetupAlert];
 expect(!button(panel,@"demo-desktop-apply").enabled,@"Apply begins disabled");
 [button(panel,@"demo-choose-a") performClick:nil];expect(menu.arguments.count==0,@"Cancelling picker is inert");
 menu.choice=@"/trusted/native client's path";[button(panel,@"demo-choose-a") performClick:nil];
 expect([menu.arguments.lastObject containsObject:menu.choice],@"Picker exact path reaches inspector argv");expect(!button(panel,@"demo-open-a").enabled,@"Duplicate finite actions disabled");
 NSUInteger before=menu.arguments.count;[menu demoClientAction:button(panel,@"demo-open-a")];expect(menu.arguments.count==before,@"Handler also refuses overlap");
 [menu beginRestart];[menu enterDemo:nil];[menu leaveDemo:nil];[menu resetDemo:nil];[menu restart:nil];expect(menu.sent.count==0,@"Native transitions refuse while setup is outstanding");
 NSDictionary *inspection=@{@"path":menu.choice,@"sha256":[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0],@"version":@"0.160.0"};finish(menu,inspection);
 expect([[menu.defaults objectForKey:[menu demoChoiceKey:@"codex"]] isEqual:inspection],@"Only qualified choice is remembered");
 [button(panel,@"demo-open-a") performClick:nil];expect([menu.arguments.lastObject containsObject:menu.choice],@"Remembered choice is revalidated");finish(menu,inspection);expect(menu.handoffs.count==1,@"Open hands off only after revalidation");
 NSString *request=[NSString stringWithContentsOfFile:menu.handoffs[0] encoding:NSUTF8StringEncoding error:nil];expect([request containsString:@"--executable"]&&[request containsString:@"launch"],@"Launch request uses exact helper contract");
 [button(panel,@"demo-open-a") performClick:nil];[menu setValue:@"cccccccccccccccccccccccccccccccc" forKey:@"generation"];finish(menu,inspection);expect(menu.handoffs.count==1,@"Stale completion cannot launch");expect([((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).stringValue containsString:@"Demo changed"],@"Stale result gives reopen guidance");[menu setValue:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" forKey:@"generation"];[menu update];
 menu.deferCallbacks=YES;[button(panel,@"demo-open-a") performClick:nil];finish(menu,inspection);[button(panel,@"demo-open-a") performClick:nil];finish(menu,inspection);
 expect(menu.callbacks.count==2,@"Two asynchronous handoffs captured");void (^older)(BOOL)=menu.callbacks[0],(^newer)(BOOL)=menu.callbacks[1];newer(NO);NSString *latestFeedback=((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).stringValue;older(YES);
 expect([((NSTextField *)findControl(panel.accessoryView,@"demo-copy-feedback")).stringValue isEqual:latestFeedback],@"Older Terminal completion cannot overwrite the latest request's failure");menu.deferCallbacks=NO;[menu.callbacks removeAllObjects];
 NSTimer *dismiss=[NSTimer timerWithTimeInterval:0.02 repeats:NO block:^(NSTimer *timer){(void)timer;NSView *content=NSApp.modalWindow.contentView;[(NSButton *)findControl(content,@"demo-choose-a") performClick:nil];[doneButton(content) performClick:nil];}];[NSRunLoop.mainRunLoop addTimer:dismiss forMode:NSModalPanelRunLoopMode];
 [menu demoSetup:nil];expect([menu valueForKey:@"demoOperation"]!=nil&&[menu valueForKey:@"demoCopyFeedback"]==nil,@"Done closes views while menu retains operation");[menu beginRestart];expect(menu.sent.count==0,@"Dismissed panel does not release transition interlock");finish(menu,inspection);expect([menu valueForKey:@"demoCopyFeedback"]==nil,@"Completion cannot update dismissed views");panel=[menu demoSetupAlert];
 [button(panel,@"demo-desktop-prepare") performClick:nil];NSDictionary *proposal=@{@"status":@"proposed",@"proposal":[root stringByAppendingPathComponent:@"demo/desktop/proposal.json"],@"proposalSha256":[@"d" stringByPaddingToLength:64 withString:@"d" startingAtIndex:0],@"review":@{@"operation":@"create",@"config":@"/Users/synthetic/Library/Application Support/Claude/claude_desktop_config.json",@"entryName":@"context-router-demo-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"backup":@"Original bytes retained",@"entry":@{@"command":@"/Users/synthetic/Library/Application Support/Context Router Trials/native-assistant-setup/managed-v1/demo/desktop/0123456789abcdef0123456789abcdef/snapshot/node",@"args":@[@"--root",root,@"--store",@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"--endpoint",@"http://127.0.0.1:3211/mcp"],@"env":@{@"NODE_OPTIONS":@"",@"NODE_DEBUG":@"",@"NODE_DEBUG_NATIVE":@""}}},@"entryName":@"context-router-demo-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"config":@"/Users/synthetic/Library/Application Support/Claude/claude_desktop_config.json",@"store":@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",@"generation":@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",@"endpoint":@"http://127.0.0.1:3211/mcp",@"applyCommand":@"never execute returned commands"};finish(menu,proposal);
 NSTimer *prepared=[NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer *timer){(void)timer;capture(NSApp.modalWindow,@"demo-prepared");[panel.buttons[0] performClick:nil];}];[NSRunLoop.mainRunLoop addTimer:prepared forMode:NSModalPanelRunLoopMode];[panel runModal];
 NSTimer *details=[NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer *timer){(void)timer;capture(NSApp.modalWindow,@"demo-exact-entry");NSTextView *text=(NSTextView *)findScroll(NSApp.modalWindow.contentView).documentView;expect([text.string containsString:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]&&[text.string containsString:@"proposalSha256"],@"Exact review includes captured runtime and digest");[text scrollRangeToVisible:NSMakeRange(text.string.length,0)];capture(NSApp.modalWindow,@"demo-exact-entry-bottom");[doneButton(NSApp.modalWindow.contentView) performClick:nil];}];[NSRunLoop.mainRunLoop addTimer:details forMode:NSModalPanelRunLoopMode];[button(panel,@"demo-desktop-details") performClick:nil];[panel.window orderOut:nil];
 expect(!button(panel,@"demo-desktop-apply").enabled,@"Review alone never permits apply");NSButton *closed=button(panel,@"demo-desktop-closed");expect(closed.state==NSControlStateValueOff,@"Confirmation begins unchecked");[closed performClick:nil];expect(button(panel,@"demo-desktop-apply").enabled,@"Explicit closed confirmation enables apply");
 [button(panel,@"demo-desktop-apply") performClick:nil];NSArray *apply=menu.arguments.lastObject;expect([apply containsObject:@"--proposal-sha256"]&&[apply containsObject:proposal[@"proposalSha256"]]&&![apply containsObject:proposal[@"applyCommand"]],@"Apply uses exact reviewed digest, never returned shell command");
 expect([menu valueForKey:@"demoProposal"]==nil,@"Submitted proposal cannot be replayed from panel");
 expect([menu applicationShouldTerminate:NSApp]==NSTerminateCancel&&menu.operation.cancelled&&menu.sent.count==0,@"Quit waits for finite cancellation before guardian command");finish(menu,@{@"status":@"applied"});expect([menu.sent isEqual:@[@"quit"]],@"Guardian Quit follows finite settlement");
 desktopFeedback(root,domain,proposal);runtimeOutcomePrecedence(root,domain);uncertainQuit(root,domain,NO);uncertainQuit(root,domain,YES);
 [menu.defaults removePersistentDomainForName:domain];puts("{\"picker\":true,\"savedRevalidation\":true,\"staleRefusal\":true,\"exactApply\":true,\"transitionInterlock\":true,\"doneLifetime\":true,\"latestTerminalFeedback\":true,\"quitOrder\":true,\"uncertainQuit\":true}");return 0;
}@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}}
