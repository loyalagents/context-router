#import "menu.m"
#include <stdio.h>
@interface FakeSetupOperation : NSObject
@property BOOL finished,success,cancelled,ownershipLost;
@property(strong) NSData *output,*errorOutput;
@property(strong) NSString *failure;
- (void)pump;
- (void)cancel:(NSString *)reason;
@end
@implementation FakeSetupOperation
- (void)pump {}
- (void)cancel:(NSString *)reason {self.cancelled=YES;self.failure=reason;}
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
 [menu.defaults removePersistentDomainForName:domain];puts("{\"picker\":true,\"savedRevalidation\":true,\"staleRefusal\":true,\"exactApply\":true,\"transitionInterlock\":true,\"doneLifetime\":true,\"latestTerminalFeedback\":true,\"quitOrder\":true}");return 0;
}@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}}
