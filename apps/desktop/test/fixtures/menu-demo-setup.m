#import "menu.m"
#include <stdio.h>

@interface CRMenu (SetupFixtureVisible)
- (NSAlert *)demoSetupAlert;
- (NSPasteboard *)demoSetupPasteboard;
- (NSAlert *)modelSetupAlert;
@end
@interface FixtureGuardian : NSObject
@property(nonatomic,getter=isRunning) BOOL running;
@end
@implementation FixtureGuardian
@end
@interface RefusingPasteboard : NSObject
@property(nonatomic) NSUInteger writes;
- (NSInteger)clearContents;
- (BOOL)setString:(NSString *)value forType:(NSPasteboardType)type;
@end
@implementation RefusingPasteboard
- (NSInteger)clearContents {self.writes++;return 1;}
- (BOOL)setString:(NSString *)value forType:(NSPasteboardType)type {(void)value;(void)type;self.writes++;return NO;}
@end
@interface SetupMenu : CRMenu
@property(nonatomic,strong) id fixturePasteboard;
@property(nonatomic) NSUInteger sent;
@end
@implementation SetupMenu
- (NSPasteboard *)demoSetupPasteboard {return self.fixturePasteboard;}
- (void)send:(NSString *)command {(void)command;self.sent++;}
- (void)openDashboard:(id)sender {(void)sender;}
@end
static NSView *find(NSView *view,NSString *identifier) {
  if([view.identifier isEqual:identifier])return view;
  for(NSView *child in view.subviews){NSView *result=find(child,identifier);if(result)return result;}
  return nil;
}
static void check(BOOL value,NSString *message) {if(!value)@throw [NSException exceptionWithName:@"FixtureAssertion" reason:message userInfo:nil];}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
  if(argc!=3)CRFail();NSString *root=[NSString stringWithUTF8String:argv[1]],*image=[NSString stringWithUTF8String:argv[2]];
  SetupMenu *menu=[[SetupMenu alloc] initWithBundle:[root stringByAppendingPathComponent:@"Demo App's.app"] root:[root stringByAppendingPathComponent:@"Root's demo"]];
  check([menu respondsToSelector:@selector(demoSetupAlert)],@"Demo setup must expose grouped copy actions without text selection");
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  check([menu respondsToSelector:@selector(modelSetupAlert)],@"Model setup must explain the disabled download and selected location");
  NSAlert *model=[menu modelSetupAlert];
  for(NSString *phrase in @[@"only in personal mode",@"same data location",@"Return to personal mode…",@"Download Qwen3.5 9B model…",@"Restart local runtime…",@"Enter demo mode…",@"launch entry points",@"not automatically shared"])
    check([model.informativeText containsString:phrase],[@"Missing model setup guidance: " stringByAppendingString:phrase]);
  NSTextView *locations=(NSTextView *)find(model.accessoryView,@"model-setup-locations");
  check([locations isKindOfClass:NSTextView.class]&&!locations.editable&&locations.selectable,@"Known locations must be read-only and selectable");
  check([locations.string containsString:[root stringByAppendingPathComponent:@"Demo App's.app"]]&&[locations.string containsString:[root stringByAppendingPathComponent:@"Root's demo"]],@"Show the exact selected app and data root, even if those paths do not exist");
  check(model.buttons.count==1&&[model.buttons[0].title isEqual:@"Done"],@"Guidance must not start downloads or change modes");
  NSString *longRoot=[root stringByAppendingString:[@"/Long data location with spaces" stringByPaddingToLength:900 withString:@"/Long data location with spaces" startingAtIndex:0]];
  [menu setValue:longRoot forKey:@"root"];NSAlert *longModel=[menu modelSetupAlert];
  NSTextView *longLocations=(NSTextView *)find(longModel.accessoryView,@"model-setup-locations");
  check([longLocations.string containsString:longRoot]&&longLocations.enclosingScrollView.hasVerticalScroller&&longLocations.textContainer.widthTracksTextView,@"Long roots must remain complete, wrapped and scrollable");
  [menu setValue:[root stringByAppendingPathComponent:@"Root's demo"] forKey:@"root"];
  NSTimer *modelTimer=[NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer *unused){(void)unused;
    [model.window.contentView layoutSubtreeIfNeeded];NSView *content=model.window.contentView;
    NSBitmapImageRep *bitmap=[content bitmapImageRepForCachingDisplayInRect:content.bounds];[content cacheDisplayInRect:content.bounds toBitmapImageRep:bitmap];
    [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[image.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"model-setup.png"] atomically:YES];
    [model.buttons[0] performClick:nil];
  }];
  [NSRunLoop.mainRunLoop addTimer:modelTimer forMode:NSModalPanelRunLoopMode];[model runModal];[model.window orderOut:nil];
  check(menu.sent==0,@"Reading setup/location guidance must not issue lifecycle commands");
  FixtureGuardian *guardian=[FixtureGuardian new];guardian.running=YES;[menu setValue:guardian forKey:@"guardian"];
  [menu setValue:@YES forKey:@"ready"];[menu setValue:@"demo" forKey:@"mode"];[menu setValue:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" forKey:@"storeId"];
  [menu setValue:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" forKey:@"generation"];[menu setValue:@"http://127.0.0.1:3211/mcp" forKey:@"mcpOrigin"];
  NSPasteboard *pasteboard=[NSPasteboard pasteboardWithUniqueName];menu.fixturePasteboard=pasteboard;
  NSAlert *alert=[menu demoSetupAlert];check(alert.buttons.count==1&&[alert.buttons[0].title isEqual:@"Done"],@"Done must be the only modal action");
  NSMutableArray *groups=[NSMutableArray array];for(NSView *view in alert.accessoryView.subviews)if([view isKindOfClass:NSBox.class])[groups addObject:((NSBox *)view).title];
  check([groups isEqual:@[@"Codex · Agent A",@"Claude Code · Agent B",@"Claude Desktop · Agent C"]],@"All three clients must have distinct visible groups");
  NSArray *ids=@[@"demo-copy-login-a",@"demo-copy-launch-a",@"demo-copy-login-b",@"demo-copy-launch-b",@"demo-copy-desktop",@"demo-copy-status"];
  NSArray *labels=@[@"Codex A sign-in",@"Codex A launch",@"Claude Code B sign-in",@"Claude Code B launch",@"Claude Desktop C setup",@"Demo status"];
  NSMutableArray *copied=[NSMutableArray array];__block NSString *failure=nil;__block NSUInteger refused=0;
  NSTimer *timer=[NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer *unused){(void)unused;@try{
    NSWindow *window=NSApp.modalWindow;check(window==alert.window,@"The actual setup modal must be open");
    NSTextField *feedback=(NSTextField *)find(alert.accessoryView,@"demo-copy-feedback");check([feedback isKindOfClass:NSTextField.class],@"Copy feedback must be visible");
    for(NSUInteger i=0;i<ids.count;i++){
      NSButton *button=(NSButton *)find(alert.accessoryView,ids[i]);check([button isKindOfClass:NSButton.class]&&button.target&&button.action,@"Each command needs a real wired Copy button");
      check([button.accessibilityLabel containsString:labels[i]],@"Each button must identify its client and action");
      [button performClick:nil];NSString *command=[pasteboard stringForType:NSPasteboardTypeString];check(command.length>0&&![command containsString:@"\n"],@"One complete command must reach the real private pasteboard");[copied addObject:command];
      check([feedback.stringValue hasPrefix:@"Copied"]&&[feedback.stringValue containsString:labels[i]],@"Success feedback must identify what was copied");check(NSApp.modalWindow==window&&window.visible,@"Copy must keep the same panel open");
    }
    NSButton *desktop=(NSButton *)find(alert.accessoryView,@"demo-copy-desktop");check([desktop.title isEqual:@"Copy setup command"],@"Desktop setup must have an explicit visible Copy action");[desktop performClick:nil];check([[pasteboard stringForType:NSPasteboardTypeString] isEqual:copied[4]],@"Repeat copy must remain usable");
    RefusingPasteboard *refusing=[RefusingPasteboard new];menu.fixturePasteboard=refusing;[desktop performClick:nil];check(refusing.writes==2&&[feedback.stringValue hasPrefix:@"Could not copy"],@"Pasteboard failure must be visible");check(NSApp.modalWindow==window,@"Failure must leave the panel open");menu.fixturePasteboard=pasteboard;
    NSDictionary *changes=@{@"ready":@NO,@"stopped":@YES,@"stopping":@YES,@"broken":@YES,@"quitting":@YES,@"mode":@"personal",@"root":@"/different/root",@"storeId":@"cccccccccccccccccccccccccccccccc",@"generation":@"dddddddddddddddddddddddddddddddd",@"mcpOrigin":@"http://127.0.0.1:4211/mcp"};
    for(NSString *key in changes){id original=[menu valueForKey:key];[menu setValue:changes[key] forKey:key];NSInteger before=pasteboard.changeCount;[desktop performClick:nil];check(pasteboard.changeCount==before&&[feedback.stringValue containsString:@"Reopen Demo setup"],@"Stale or unavailable context must refuse before touching the pasteboard");check(NSApp.modalWindow==window,@"Refusal must leave the panel open");[menu setValue:original forKey:key];refused++;}
    guardian.running=NO;NSInteger before=pasteboard.changeCount;[desktop performClick:nil];check(pasteboard.changeCount==before&&[feedback.stringValue containsString:@"Reopen Demo setup"],@"Lost guardian must refuse copy");guardian.running=YES;refused++;
    [desktop performClick:nil];check(menu.sent==0,@"Copy must not send lifecycle or helper commands");
    [alert.window.contentView layoutSubtreeIfNeeded];NSView *view=alert.window.contentView;
    NSBitmapImageRep *bitmap=[view bitmapImageRepForCachingDisplayInRect:view.bounds];[view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
    check([[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:image atomically:YES],@"Synthetic AppKit panel render must be retained");
    [alert.buttons[0] performClick:nil];
  }@catch(NSException *error){failure=error.reason?:@"Fixture assertion";[NSApp abortModal];}}];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSModalPanelRunLoopMode];
  NSModalResponse response=[alert runModal];[alert.window orderOut:nil];[pasteboard releaseGlobally];
  check(!failure,failure?:@"");check(response==NSAlertFirstButtonReturn,@"Only Done should finish the modal");
  NSDictionary *result=@{@"commands":copied,@"refusals":@(refused),@"modalCopy":@YES,@"privatePasteboard":@YES,@"sent":@(menu.sent)};
  NSData *data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];fwrite(data.bytes,1,data.length,stdout);puts("");return 0;
}@catch(NSException *error){fprintf(stderr,"%s\n",(error.reason?:@"Fixture failure").UTF8String);return 1;}}}
