#import <AppKit/AppKit.h>
#import "menu.h"
#import "maintenance.h"
#import "process.h"
#import "unlock-file.h"
#import "demo-operation.h"
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>
@interface CRMenu : NSObject <NSApplicationDelegate>
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root;
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root uiPort:(NSInteger)ui mcpPort:(NSInteger)mcp demoPort:(NSInteger)demo;
@end
@implementation CRMenu {
  NSString *_bundle,*_root,*_generation,*_origin,*_unlockFile,*_mode,*_storeId,*_mcpOrigin;
  NSInteger _uiPort,_mcpPort,_demoPort;BOOL _preparingDemo,_demoFailed,_demoUnavailable;
  NSStatusItem *_status;NSMenuItem *_label;NSMutableDictionary<NSString *,NSMenuItem *> *_items;
  NSTask *_guardian;NSPipe *_input,*_output;CRWriteQueue *_commands;CRFrames *_frames;NSTimer *_timer;
  NSDictionary *_demoCopyBinding;NSArray<NSString *> *_demoCopyCommands,*_demoCopyNames;NSTextField *_demoCopyFeedback;
  CRDemoOperation *_demoOperation;NSTimer *_demoOperationTimer;NSDictionary *_demoRequest,*_demoProposal,*_demoOutcome;
  NSMutableDictionary *_demoChoices;NSMutableArray<NSButton *> *_demoActions;NSString *_demoPanelIdentity,*_demoLatestRequestIdentity;
  NSTextField *_demoReview;NSButton *_demoClosed,*_demoApply,*_demoDetails;BOOL _demoQuitPending,_demoUncertainQuitPrompting,_demoUncertainQuitConfirmed;
  BOOL _ready,_stopping,_quitting,_stopped,_broken,_download,_cancelPending,_sleepInvalidated,_openOnReady,_exitObserved;double _unlockUntil;
}
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root {
  return [self initWithBundle:bundle root:root uiPort:0 mcpPort:8787 demoPort:8790];
}
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root uiPort:(NSInteger)ui mcpPort:(NSInteger)mcp demoPort:(NSInteger)demo {
  self=[super init];if(self){_bundle=bundle;_root=root;_uiPort=ui;_mcpPort=mcp;_demoPort=demo;_mode=@"personal";_items=[NSMutableDictionary dictionary];_openOnReady=YES;}return self;
}
- (void)add:(NSString *)title action:(SEL)action key:(NSString *)key menu:(NSMenu *)menu {
  NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];item.target=self;[menu addItem:item];_items[key]=item;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;_status=[[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];_status.button.title=@"CR";_status.button.toolTip=@"Context Router";_status.button.accessibilityLabel=@"Context Router";
  NSMenu *menu=[NSMenu new];menu.autoenablesItems=NO;_label=[[NSMenuItem alloc] initWithTitle:@"Starting local runtime…" action:nil keyEquivalent:@""];_label.enabled=NO;[menu addItem:_label];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Open dashboard" action:@selector(openDashboard:) key:@"open" menu:menu];[self add:@"New unlock code…" action:@selector(newUnlock:) key:@"unlock" menu:menu];[self add:@"Copy unlock code" action:@selector(copyUnlock:) key:@"copy" menu:menu];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Enter demo mode…" action:@selector(enterDemo:) key:@"enter-demo" menu:menu];
  [self add:@"Return to personal mode…" action:@selector(leaveDemo:) key:@"leave-demo" menu:menu];
  [self add:@"Reset sample data…" action:@selector(resetDemo:) key:@"reset-demo" menu:menu];
  [self add:@"Demo setup…" action:@selector(demoSetup:) key:@"setup-demo" menu:menu];
  [self add:@"Cancel demo preparation" action:@selector(cancelDemo:) key:@"cancel-demo" menu:menu];
  [self add:@"Return to previous mode" action:@selector(returnPrevious:) key:@"return-previous" menu:menu];
  [self add:@"Retry demo preparation…" action:@selector(retryDemo:) key:@"retry-demo" menu:menu];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Download Qwen3.5 9B model…" action:@selector(downloadModel:) key:@"download" menu:menu];
  [self add:@"Model setup and location…" action:@selector(modelSetup:) key:@"model-setup" menu:menu];
  [self add:@"Cancel download" action:@selector(cancelDownload:) key:@"cancel" menu:menu];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Restart local runtime…" action:@selector(restart:) key:@"restart" menu:menu];[self add:@"Quit Context Router" action:@selector(quit:) key:@"quit" menu:menu];_status.menu=menu;
  NSNotificationCenter *center=NSWorkspace.sharedWorkspace.notificationCenter;
  [center addObserver:self selector:@selector(sleepWake:) name:NSWorkspaceWillSleepNotification object:nil];[center addObserver:self selector:@selector(sleepWake:) name:NSWorkspaceDidWakeNotification object:nil];
  @try {
    _input=[NSPipe pipe];_output=[NSPipe pipe];_frames=[CRFrames new];_guardian=[NSTask new];
    _guardian.executableURL=[NSURL fileURLWithPath:[_bundle stringByAppendingPathComponent:@"Contents/MacOS/context-router"]];
    _guardian.arguments=@[@"guardian",@"--root",_root,@"--ui-port",[@(_uiPort) stringValue],@"--mcp-port",[@(_mcpPort) stringValue],@"--demo-mcp-port",[@(_demoPort) stringValue]];_guardian.environment=@{};_guardian.currentDirectoryURL=[NSURL fileURLWithPath:_bundle];
    _guardian.standardInput=_input;_guardian.standardOutput=_output;_guardian.standardError=[NSFileHandle fileHandleWithNullDevice];
    __weak CRMenu *weakSelf=self;_guardian.terminationHandler=^(NSTask *task){(void)task;dispatch_async(dispatch_get_main_queue(),^{[weakSelf tick:nil];});};
    NSError *error=nil;if(![_guardian launchAndReturnError:&error])CRFail();
    [_input.fileHandleForReading closeFile];[_output.fileHandleForWriting closeFile];
    int output=_output.fileHandleForReading.fileDescriptor,flags=fcntl(output,F_GETFL);if(flags<0||fcntl(output,F_SETFL,flags|O_NONBLOCK))CRFail();
    _commands=[[CRWriteQueue alloc] initWithFD:_input.fileHandleForWriting.fileDescriptor];
    _timer=[NSTimer timerWithTimeInterval:0.05 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
    [[NSRunLoop mainRunLoop] addTimer:_timer forMode:NSRunLoopCommonModes];[[NSRunLoop mainRunLoop] addTimer:_timer forMode:NSModalPanelRunLoopMode];
  }@catch(NSException *e){(void)e;[self breakControl];}
  [self update];
}
- (void)update {
  if(_demoOutcome&&![self demoBindingCurrent:_demoOutcome[@"binding"]])_demoOutcome=nil;
  BOOL active=_ready&&!_stopping&&!_broken&&_guardian.running;
  for(NSString *key in @[@"open",@"unlock",@"restart"])_items[key].enabled=active&&(![key isEqual:@"restart"]||!_demoOperation);
  _items[@"copy"].enabled=active&&_unlockFile&&CRExpiryNow()<_unlockUntil;
  BOOL demo=[_mode isEqual:@"demo"];
  // Keep the status item's contents compact while macOS allocates menu-bar space.
  _status.button.title=@"CR";
  NSString *description=!_storeId?@"Context Router":demo?@"Context Router — Demo mode · historical sample":@"Context Router — Personal mode";
  _status.button.toolTip=description;_status.button.accessibilityLabel=description;
  _items[@"enter-demo"].enabled=active&&!demo&&!_demoOperation;_items[@"leave-demo"].enabled=demo&&(_ready||_demoUnavailable)&&!_stopping&&!_broken&&_guardian.running&&!_demoOperation;
  _items[@"reset-demo"].enabled=active&&demo&&!_demoOperation;_items[@"setup-demo"].enabled=active&&demo;
  _items[@"cancel-demo"].enabled=_preparingDemo&&!_demoFailed&&!_stopping&&!_broken;
  for(NSString *key in @[@"return-previous",@"retry-demo"])_items[key].enabled=_demoFailed&&!_stopping&&!_broken;
  _items[@"download"].title=demo?@"Download model — personal mode only":@"Download Qwen3.5 9B model…";
  _items[@"download"].toolTip=demo?@"Demo reuses verified models in the same data location. Choose Model setup and location… for setup steps.":nil;
  _items[@"model-setup"].enabled=!_quitting;
  _items[@"download"].enabled=active&&!demo&&!_download;_items[@"cancel"].enabled=active&&_download&&!_cancelPending;_items[@"quit"].enabled=!_quitting;[self updateDemoActions];
  if(!_quitting&&!_broken&&!_stopped){if(_demoOperation.ownershipLost)_label.title=@"Setup ownership uncertain — state retained";else if(_demoQuitPending)_label.title=@"Quit pending — finishing setup shutdown…";}
}
- (void)breakControl {
  _broken=YES;_ready=NO;_label.title=@"Runtime unavailable — state retained";
  @try{[_input.fileHandleForWriting closeFile];}@catch(NSException *e){(void)e;}[self update];
}
- (void)send:(NSString *)command {
  @try{if(!_generation||_broken||!_guardian.running)CRFail();NSMutableData *data=[[NSJSONSerialization dataWithJSONObject:@{@"version":@1,@"generation":_generation,@"command":command} options:0 error:nil] mutableCopy];[data appendBytes:"\n" length:1];[_commands append:data];}
  @catch(NSException *e){(void)e;[self breakControl];}
}
- (void)origin:(id)value {
  if(!CRPattern(value,@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}"))CRFail();NSURL *url=[NSURL URLWithString:value];if(url.port.integerValue>65535)CRFail();_origin=value;
}
- (BOOL)unlock:(id)value {
  NSString *exports=[[_root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:_generation];
  if(![value isKindOfClass:[NSString class]]||![[value stringByDeletingLastPathComponent] isEqual:exports]||!CRPattern([value lastPathComponent],@"unlock-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.token"))CRFail();
  if(_stopping||_quitting)return NO;
  if(!CRUnlockFileAvailable(value)){_unlockFile=nil;_unlockUntil=0;return NO;}
  _unlockFile=value;_unlockUntil=CRExpiryNow()+300;return YES;
}
- (void)record:(NSDictionary *)record {
  if(!CRInteger(record[@"version"],1,1)||!CRPattern(record[@"generation"],@"[a-f0-9]{32}"))CRFail();NSString *type=record[@"type"];
  if([type isEqual:@"starting"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"phase"])||![@[@"preparing",@"preparing-demo",@"demo-unavailable"] containsObject:record[@"phase"]]||(_generation&&!_stopped))CRFail();
    _demoUnavailable=[record[@"phase"] isEqual:@"demo-unavailable"];_preparingDemo=[record[@"phase"] isEqual:@"preparing-demo"];_demoFailed=NO;_generation=record[@"generation"];_ready=NO;_stopped=NO;_stopping=NO;_download=NO;_cancelPending=NO;_origin=nil;_unlockFile=nil;_label.title=_demoUnavailable?@"Demo unavailable — return to personal mode or quit":_preparingDemo?@"Preparing historical sample data…":@"Starting local runtime…";return;
  }
  if(!_generation||![record[@"generation"] isEqual:_generation]||_stopped)CRFail();
  if([type isEqual:@"mode"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"mode",@"storeId"])||![@[@"personal",@"demo"] containsObject:record[@"mode"]]||!CRPattern(record[@"storeId"],@"[a-f0-9]{32}"))CRFail();_mode=record[@"mode"];_storeId=record[@"storeId"];
  }else if([type isEqual:@"demo-failed"]){
    if(!_preparingDemo||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();_demoFailed=YES;_stopping=NO;_label.title=@"Demo preparation stopped — candidate retained";
  }else if([type isEqual:@"transition-refused"]){
    if((!_ready&&!_demoUnavailable)||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();_stopping=NO;_label.title=@"Mode change unavailable — destination port is occupied";
  }else if([type isEqual:@"ready"]){
    if(_ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"mcpOrigin",@"unlockFile",@"modelEnabled"])||CFGetTypeID((__bridge CFTypeRef)record[@"modelEnabled"])!=CFBooleanGetTypeID()||!CRPattern(record[@"mcpOrigin"],@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}/mcp")||[NSURL URLWithString:record[@"mcpOrigin"]].port.integerValue>65535)CRFail();
    [self origin:record[@"origin"]];[self unlock:record[@"unlockFile"]];_mcpOrigin=record[@"mcpOrigin"];_ready=YES;
    if(!_stopping&&!_quitting){_label.title=[NSString stringWithFormat:@"%@ · %@",[_mode isEqual:@"demo"]?@"Demo ready":@"Dashboard ready",[record[@"modelEnabled"] boolValue]?@"AI loading":@"AI not enabled"];if(_sleepInvalidated)[self send:@"model-unavailable"];}
    if(_quitting){_stopping=YES;[self send:@"quit"];}
    else if(!_stopping&&!_broken&&_openOnReady){_openOnReady=NO;[self openDashboard:nil];}
  }else if([type isEqual:@"unlock"]){
    if(!_ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"unlockFile"])||![_origin isEqual:record[@"origin"]])CRFail();if([self unlock:record[@"unlockFile"]])[self performSelector:@selector(showUnlock) withObject:nil afterDelay:0];
  }else if([type isEqual:@"model-status"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"state"])||![@[@"available",@"busy",@"loading",@"unavailable"] containsObject:record[@"state"]])CRFail();
    _label.title=[NSString stringWithFormat:@"%@ · %@",[_mode isEqual:@"demo"]?@"Demo ready":@"Dashboard ready",[record[@"state"] isEqual:@"available"]?@"AI available":[record[@"state"] isEqual:@"busy"]?@"AI working":[record[@"state"] isEqual:@"loading"]?@"AI loading":@"restart required for AI"];
  }else if([type isEqual:@"download-progress"]){
    if(!_download||!CRExact(record,@[@"version",@"generation",@"type",@"received",@"total"])||!CRInteger(record[@"total"],5680522464LL,5680522464LL)||!CRInteger(record[@"received"],0,5680522464LL))CRFail();_label.title=[NSString stringWithFormat:@"Downloading model · %.0f%%",100*[record[@"received"] doubleValue]/5680522464.0];
  }else if([@[@"download-starting",@"download-complete",@"download-cancelled",@"download-failed"] containsObject:type]){
    if(!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();_download=[type isEqual:@"download-starting"];if(!_download)_cancelPending=NO;
    _label.title=_download?@"Downloading model…":[type isEqual:@"download-complete"]?@"Model installed · restart to enable AI":[type isEqual:@"download-cancelled"]?@"Download cancelled · dashboard ready":@"Download failed · dashboard ready";
  }else if([type isEqual:@"stopped"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"outcome"])||![@[@"ok",@"failed",@"uncertain"] containsObject:record[@"outcome"]])CRFail();_stopped=YES;_ready=NO;_unlockFile=nil;
    _label.title=[record[@"outcome"] isEqual:@"ok"]?@"Local runtime stopped":@"Runtime stopped — state retained";
  }else CRFail();
}
- (void)tick:(NSTimer *)timer {
  (void)timer;
  @try{if(!_broken){[_commands flush];for(NSDictionary *record in [_frames readFrom:_output.fileHandleForReading.fileDescriptor])[self record:record];if(_frames.ended&&!_stopped)[self breakControl];}}
  @catch(NSException *e){(void)e;[self breakControl];}
  if(_guardian&&!_guardian.running&&!_exitObserved){_exitObserved=YES;[_timer invalidate];if(!_stopped)[self breakControl];if(_quitting){[NSApp replyToApplicationShouldTerminate:YES];[NSApp terminate:nil];}}
  [self update];
}
- (NSString *)code {
  if(!_ready||_stopping||_quitting||!_unlockFile||CRExpiryNow()>=_unlockUntil)CRFail();NSString *exports=_unlockFile.stringByDeletingLastPathComponent;(void)CRPrivatePin(exports,YES);
  NSString *code=[[NSString alloc] initWithData:CRReadData(_unlockFile,1024,YES) encoding:NSUTF8StringEncoding];if(!CRPattern(code,@"cr_ui_unlock_[A-Za-z0-9_-]{43}\\n"))CRFail();return [code substringToIndex:code.length-1];
}
- (void)showUnlock {
  if(_stopping||_quitting)return;
  @try{NSAlert *alert=[NSAlert new];alert.messageText=@"Unlock Context Router";alert.informativeText=@"Paste this one-use code into the dashboard. It expires after five minutes.";
    NSTextField *field=[[NSTextField alloc] initWithFrame:NSMakeRect(0,0,460,44)];field.stringValue=[self code];field.editable=NO;field.selectable=YES;alert.accessoryView=field;[alert addButtonWithTitle:@"Copy code"];[alert addButtonWithTitle:@"Done"];
    [NSApp activateIgnoringOtherApps:YES];if([alert runModal]==NSAlertFirstButtonReturn)[self copyUnlock:nil];field.stringValue=@"";
  }@catch(NSException *e){(void)e;_unlockFile=nil;_label.title=@"Request a new unlock code";}[self update];
}
- (void)openDashboard:(id)sender {(void)sender;if(_ready&&_origin)[NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:_origin]];}
- (void)newUnlock:(id)sender {(void)sender;if(_ready)[self send:@"unlock"];}
- (void)copyUnlock:(id)sender {(void)sender;if(_stopping||_quitting)return;@try{NSString *code=[self code];[NSPasteboard.generalPasteboard clearContents];[NSPasteboard.generalPasteboard setString:code forType:NSPasteboardTypeString];}@catch(NSException *e){(void)e;_unlockFile=nil;_label.title=@"Request a new unlock code";}[self update];}
- (NSAlert *)modelSetupAlert {
  NSAlert *alert=[NSAlert new];alert.messageText=@"Model setup and location";
  alert.informativeText=@"Demo reuses verified model files from the same data location. Downloads are available only in personal mode.\n\nTo set up AI for demo, keep this app and data location:\n1. Return to personal mode…\n2. Choose Download Qwen3.5 9B model… if needed and wait for completion.\n3. Choose Restart local runtime…, then Enter demo mode…\n\nDifferent launch entry points, such as Finder and a custom launcher, can select different data locations. Models in another location are not automatically shared. Use the same launch entry point when returning.";
  NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,580,110)];scroll.hasVerticalScroller=YES;
  NSTextView *locations=[[NSTextView alloc] initWithFrame:scroll.contentView.bounds];locations.identifier=@"model-setup-locations";
  locations.editable=NO;locations.selectable=YES;locations.font=[NSFont systemFontOfSize:12];
  locations.horizontallyResizable=NO;locations.verticallyResizable=YES;locations.autoresizingMask=NSViewWidthSizable;
  locations.textContainer.widthTracksTextView=YES;
  locations.string=[NSString stringWithFormat:@"App: %@\n\nData and models: %@",_bundle,_root];
  scroll.documentView=locations;alert.accessoryView=scroll;[alert addButtonWithTitle:@"Done"];return alert;
}
- (void)modelSetup:(id)sender {(void)sender;[[self modelSetupAlert] runModal];}
- (void)downloadModel:(id)sender {
  (void)sender;NSAlert *alert=[NSAlert new];alert.messageText=@"Download Qwen3.5 9B?";alert.informativeText=@"Download the pinned Q4_K_M model (5,680,522,464 bytes, about 5.7 GB) from unsloth on Hugging Face for local AI. Allow at least 6.8 GB free space. The dashboard stays available. A runtime restart is required afterward.";[alert addButtonWithTitle:@"Download"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]==NSAlertFirstButtonReturn&&_ready&&!_stopping){_download=YES;[self send:@"download"];}[self update];
}
- (void)cancelDownload:(id)sender {(void)sender;if(_download&&!_cancelPending){_cancelPending=YES;[self send:@"cancel-download"];}[self update];}
- (void)beginRestart {if(_demoOperation)return;_sleepInvalidated=NO;_openOnReady=YES;_stopping=YES;_label.title=@"Stopping local runtime…";[self send:@"restart"];[self update];}
- (void)restart:(id)sender {
  (void)sender;if(_demoOperation)return;NSAlert *alert=[NSAlert new];alert.messageText=@"Restart local runtime?";alert.informativeText=@"This signs out browser sessions, interrupts MCP connections, drains current work, and starts a fresh local AI session. The current dashboard will open when ready; unlock there with a new code. Older tabs may have an obsolete address. Data, identity, client credentials and installed model assets are preserved.";[alert addButtonWithTitle:@"Restart"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]==NSAlertFirstButtonReturn&&_ready&&!_stopping&&!_demoOperation)[self beginRestart];[self update];
}
- (void)beginModeChange:(NSString *)command {if(_demoOperation)return;_sleepInvalidated=NO;_stopping=YES;_openOnReady=YES;_label.title=@"Stopping local runtime…";[self send:command];}
- (void)changeMode:(NSString *)command title:(NSString *)title detail:(NSString *)detail {
  if(_demoOperation)return;NSAlert *alert=[NSAlert new];alert.messageText=title;alert.informativeText=detail;[alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]==NSAlertFirstButtonReturn&&(_ready||(_demoUnavailable&&[command isEqual:@"leave-demo"]))&&!_stopping&&!_broken&&!_demoOperation)[self beginModeChange:command];[self update];
}
- (void)enterDemo:(id)sender {(void)sender;[self changeMode:@"enter-demo" title:@"Enter demo mode?" detail:@"This closes current browser sessions and MCP connections. Personal data and model assets stay retained. Demo uses a separate persistent historical sample store and reuses verified installed model weights with a fresh local AI session. Start fresh client conversations after switching."];}
- (void)leaveDemo:(id)sender {(void)sender;[self changeMode:@"leave-demo" title:@"Return to personal mode?" detail:@"This closes demo browser sessions and MCP connections and returns to your personal store. Demo edits and client profiles stay retained. Start fresh client conversations after switching."];}
- (void)resetDemo:(id)sender {(void)sender;[self changeMode:@"reset-demo" title:@"Reset sample data?" detail:@"This creates a fresh demo store and identity with the original 189 active historical memories, definitions, import history and client tokens. Later demo edits, custom clients and grant changes do not carry forward. The old demo store, exports and login profiles stay retained. Existing connections and Desktop proposals become stale; reconnect with the new setup commands and start fresh conversations."];}
- (void)cancelDemo:(id)sender {(void)sender;_stopping=YES;[self send:@"cancel-demo"];[self update];}
- (void)returnPrevious:(id)sender {(void)sender;if(_demoFailed){_stopping=YES;_openOnReady=YES;[self send:@"return-previous"];}[self update];}
- (void)retryDemo:(id)sender {(void)sender;if(_demoFailed){NSAlert *a=[NSAlert new];a.messageText=@"Prepare a fresh demo candidate?";a.informativeText=@"The failed candidate remains retained. This starts a new sample import with fresh identity and credentials.";[a addButtonWithTitle:@"Retry"];[a addButtonWithTitle:@"Cancel"];if([a runModal]==NSAlertFirstButtonReturn){_stopping=YES;[self send:@"retry-demo"];}}[self update];}
- (NSUserDefaults *)demoDefaults {return NSUserDefaults.standardUserDefaults;}
- (NSString *)demoChoiceKey:(NSString *)vendor {return [NSString stringWithFormat:@"CRDemoExecutable.%@.%@",CRSHA256([_root dataUsingEncoding:NSUTF8StringEncoding]),vendor];}
- (BOOL)demoBindingCurrent:(NSDictionary *)binding {NSDictionary *current=[self demoSetupContext];return current&&[current isEqualToDictionary:binding];}
- (void)updateDemoActions {
  BOOL available=!_demoOperation&&[self demoBindingCurrent:_demoCopyBinding];
  for(NSButton *button in _demoActions)button.enabled=available;
  _demoApply.enabled=available&&_demoProposal&&_demoClosed.state==NSControlStateValueOn;
  _demoClosed.enabled=available&&_demoProposal;_demoDetails.enabled=available&&_demoProposal;
}
- (void)demoClosedChanged:(id)sender {(void)sender;[self updateDemoActions];}
- (NSString *)chooseDemoExecutable:(NSString *)vendor {
  NSOpenPanel *picker=[NSOpenPanel openPanel];picker.canChooseFiles=YES;picker.canChooseDirectories=NO;picker.allowsMultipleSelection=NO;picker.treatsFilePackagesAsDirectories=YES;
  picker.message=[NSString stringWithFormat:@"Choose the native %@ executable. For nvm/npm installs, choose the native payload inside the package, not its JavaScript wrapper.",vendor];picker.prompt=@"Check executable";
  return [picker runModal]==NSModalResponseOK?picker.URL.path:nil;
}
- (BOOL)confirmDemoProvider:(BOOL)login vendor:(NSString *)vendor {
  NSAlert *alert=[NSAlert new];alert.messageText=[NSString stringWithFormat:@"%@ %@ in Terminal?",login?@"Sign in to":@"Open",vendor];
  alert.informativeText=@"This uses a separate demo provider profile. The provider may receive retrieved historical sample context. Continue only if you consent. Start a fresh conversation; approve each intended change in Codex.";
  [alert addButtonWithTitle:@"Continue"];[alert addButtonWithTitle:@"Cancel"];return [alert runModal]==NSAlertFirstButtonReturn;
}
- (NSArray *)demoArguments:(NSDictionary *)binding action:(NSArray *)action {
  return [@[@"demo",@"--root",binding[@"root"],@"--store",binding[@"store"],@"--generation",binding[@"generation"],@"--endpoint",binding[@"endpoint"]] arrayByAddingObjectsFromArray:action];
}
- (CRDemoOperation *)demoOperationWithArguments:(NSArray *)arguments {
  NSString *search=[NSString stringWithFormat:@"%@/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",NSHomeDirectory()];
  return [[CRDemoOperation alloc] initWithExecutable:[_bundle stringByAppendingPathComponent:@"Contents/MacOS/context-router"] arguments:arguments directory:_bundle environment:@{@"PATH":search,@"LANG":@"en_US.UTF-8"} timeout:120 grace:5];
}
- (void)startDemoOperation:(NSArray *)action request:(NSDictionary *)request {
  if(_demoOperation||![self demoBindingCurrent:_demoCopyBinding]){_demoCopyFeedback.stringValue=@"Reopen Demo setup after the current operation finishes.";return;}
  _demoCopyFeedback.toolTip=nil;if([@[@"prepare",@"apply"] containsObject:request[@"kind"]])_demoOutcome=nil;
  NSMutableDictionary *bound=[request mutableCopy];bound[@"binding"]=_demoCopyBinding;bound[@"panel"]=_demoPanelIdentity;bound[@"id"]=CRRandom(16);_demoLatestRequestIdentity=bound[@"id"];
  @try{
    _demoOperation=[self demoOperationWithArguments:[[self demoArguments:_demoCopyBinding action:action] arrayByAddingObject:@"--native-result"]];_demoRequest=bound;
    _demoCopyFeedback.stringValue=@"Checking setup… You can close this panel while it finishes.";
    _demoOperationTimer=[NSTimer timerWithTimeInterval:0.05 target:self selector:@selector(pollDemoOperation:) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:_demoOperationTimer forMode:NSRunLoopCommonModes];[NSRunLoop.mainRunLoop addTimer:_demoOperationTimer forMode:NSModalPanelRunLoopMode];
  }@catch(NSException *error){(void)error;_demoOperation=nil;_demoRequest=nil;_demoCopyFeedback.stringValue=@"Could not start setup. Reopen Demo setup and try again.";}
  [self update];
}
- (void)demoClientAction:(NSButton *)sender {
  if(sender.tag<0||sender.tag>=6)return;
  if(_demoOperation||![self demoBindingCurrent:_demoCopyBinding]){_demoCopyFeedback.stringValue=@"Reopen Demo setup for the current demo.";return;}
  NSString *vendor=sender.tag<3?@"codex":@"claude",*action=@[@"login",@"launch",@"choose"][sender.tag%3];
  NSString *selected=_demoChoices[vendor][@"path"];
  if([action isEqual:@"choose"]){selected=[self chooseDemoExecutable:vendor];if(!selected)return;}
  else if(![self confirmDemoProvider:[action isEqual:@"login"] vendor:vendor])return;
  if(![self demoBindingCurrent:_demoCopyBinding]){_demoCopyFeedback.stringValue=@"Demo changed. Reopen Demo setup.";return;}
  NSMutableArray *arguments=[@[@"client",@"inspect",@"--client",vendor] mutableCopy];if(selected)[arguments addObjectsFromArray:@[@"--executable",selected]];
  [self startDemoOperation:arguments request:@{@"kind":@"inspect",@"vendor":vendor,@"action":action}];
}
- (void)openDemoTerminal:(NSString *)file completion:(void (^)(BOOL))completion {
  NSWorkspaceOpenConfiguration *configuration=[NSWorkspaceOpenConfiguration configuration];configuration.activates=YES;
  [NSWorkspace.sharedWorkspace openURLs:@[[NSURL fileURLWithPath:file]] withApplicationAtURL:[NSURL fileURLWithPath:@"/System/Applications/Utilities/Terminal.app"] configuration:configuration completionHandler:^(NSRunningApplication *app,NSError *error){dispatch_async(dispatch_get_main_queue(),^{completion(app!=nil&&error==nil);});}];
}
- (void)handoffDemoClient:(NSDictionary *)result request:(NSDictionary *)request {
  if(![self demoBindingCurrent:request[@"binding"]])return;
  NSString *vendor=request[@"vendor"],*role=[vendor isEqual:@"codex"]?@"A":@"B";
  NSMutableArray *action=[@[request[@"action"],role,@"--client",vendor,@"--executable",result[@"path"]] mutableCopy];if([vendor isEqual:@"claude"])[action addObjectsFromArray:@[@"--auth",@"subscription"]];
  @try{
    NSString *file=CRDemoLaunchRequest(_root,[_bundle stringByAppendingPathComponent:@"Contents/MacOS/context-router"],[self demoArguments:request[@"binding"] action:action]);
    __weak CRMenu *weakSelf=self;[self openDemoTerminal:file completion:^(BOOL opened){CRMenu *menu=weakSelf;if(!menu||![menu->_demoPanelIdentity isEqual:request[@"panel"]]||![menu->_demoLatestRequestIdentity isEqual:request[@"id"]]||![menu demoBindingCurrent:request[@"binding"]])return;
      menu->_demoCopyFeedback.stringValue=opened?@"Terminal opened. Continue there; connection is not yet confirmed. Start a fresh conversation.":@"Terminal could not open. Use Copy sign-in/launch, or reopen setup to try again. The request is retained.";
    }];
  }@catch(NSException *error){(void)error;if(![_demoPanelIdentity isEqual:request[@"panel"]]||![_demoLatestRequestIdentity isEqual:request[@"id"]]||![self demoBindingCurrent:request[@"binding"]])return;_demoCopyFeedback.stringValue=@"Could not prepare Terminal. Use the Copy command; retained requests are not removed.";}
}
- (void)prepareDemoDesktop:(id)sender {(void)sender;if(_demoOperation||![self demoBindingCurrent:_demoCopyBinding])return;_demoProposal=nil;_demoClosed.state=NSControlStateValueOff;[self startDemoOperation:@[@"desktop",@"prepare"] request:@{@"kind":@"prepare"}];}
- (void)applyDemoDesktop:(id)sender {
  (void)sender;if(!_demoProposal||_demoClosed.state!=NSControlStateValueOn||_demoOperation||![self demoBindingCurrent:_demoCopyBinding])return;
  [self startDemoOperation:@[@"desktop",@"apply",@"--proposal",_demoProposal[@"proposal"],@"--proposal-sha256",_demoProposal[@"proposalSha256"],@"--desktop-closed"] request:@{@"kind":@"apply"}];
  if(_demoOperation){_demoProposal=nil;_demoClosed.state=NSControlStateValueOff;_demoReview.stringValue=@"Applying the reviewed change. Any interrupted outcome must be inspected before a new proposal.";}
}
- (void)showDemoDetails:(id)sender {
  (void)sender;if(!_demoProposal)return;NSAlert *alert=[NSAlert new];alert.messageText=@"Exact Claude Desktop entry";alert.informativeText=@"Only this owned entry changes. Unrelated settings are preserved. Configuration formatting may normalize.";
  NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,620,280)];scroll.hasVerticalScroller=YES;
  NSTextView *text=[[NSTextView alloc] initWithFrame:scroll.bounds];text.editable=NO;text.selectable=YES;text.font=[NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
  NSMutableDictionary *details=[_demoProposal[@"review"] mutableCopy];details[@"binding"]=_demoCopyBinding;details[@"proposalSha256"]=_demoProposal[@"proposalSha256"];
  text.string=[[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:details options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil] encoding:NSUTF8StringEncoding];scroll.documentView=text;alert.accessoryView=scroll;[alert addButtonWithTitle:@"Done"];[alert runModal];
}
- (void)completeDemoQuit {[NSApp terminate:nil];}
- (NSString *)demoFailureMessage:(CRDemoOperation *)operation request:(NSDictionary *)request {
  if(operation.failure.length)return operation.failure;
  NSString *fallback=[request[@"kind"] isEqual:@"inspect"]?@"Client unavailable. Use Choose executable… to select a qualified native executable. Its version and isolation checks must pass before an assistant starts.":[request[@"kind"] isEqual:@"prepare"]?@"Setup could not be prepared. Inspect retained setup state before retrying.":@"Apply is not confirmed. Inspect retained setup state; do not replay an uncertain apply.";
  if(operation.cancelled)return fallback;
  // Raw stderr can contain loader or pre-import diagnostics. Only the complete,
  // explicitly requested helper envelope carries a safe user-facing reason.
  NSDictionary *value=[NSJSONSerialization JSONObjectWithData:operation.output options:0 error:nil];
  if(![value isKindOfClass:NSDictionary.class]||!CRExact(value,@[@"version",@"status",@"action",@"binding",@"message"])||!CRInteger(value[@"version"],1,1)||![value[@"status"] isEqual:@"failed"]||![value[@"action"] isEqual:request[@"kind"]]||![value[@"binding"] isEqual:request[@"binding"]])return fallback;
  NSString *message=value[@"message"];
  if(![message isKindOfClass:NSString.class]||![[message stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] length]||[message lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>800||[message rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound||[message rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location!=NSNotFound)return fallback;
  return message;
}
- (void)retainDemoOutcome:(NSString *)status message:(NSString *)message request:(NSDictionary *)request {
  if(![@[@"prepare",@"apply"] containsObject:request[@"kind"]]||![self demoBindingCurrent:request[@"binding"]]||![_demoLatestRequestIdentity isEqual:request[@"id"]])return;
  _demoOutcome=@{@"binding":request[@"binding"],@"id":request[@"id"],@"kind":request[@"kind"],@"status":status,@"message":message};
  // A panel reopened while work ran may show its safe outcome, but never inherit
  // the dismissed panel's proposal or closed-Desktop attestation.
  if([_demoCopyBinding isEqual:request[@"binding"]]){_demoCopyFeedback.toolTip=nil;_demoCopyFeedback.stringValue=message;}
}
- (BOOL)confirmUncertainDemoQuit {
  NSAlert *alert=[NSAlert new];alert.messageText=@"Quit with setup ownership uncertain?";
  alert.informativeText=@"The setup helper may still be running and may finish changing Claude Desktop configuration. Quit will stop the local runtime without further helper signals or a claim that setup finished. State is retained. Keep Desktop and config editors closed, and inspect the retained state before opening Desktop or retrying setup.";
  [alert addButtonWithTitle:@"Cancel"];[alert addButtonWithTitle:@"Quit and retain state"];return [alert runModal]==NSAlertSecondButtonReturn;
}
- (void)pollDemoOperation:(NSTimer *)timer {
  (void)timer;if(!_demoOperation)return;if(!_demoOperation.ownershipLost)[_demoOperation pump];
  if(_demoOperation.ownershipLost){
    [_demoOperationTimer invalidate];_demoOperationTimer=nil;
    NSString *message=_demoOperation.failure?:@"Setup ownership is uncertain. Retain state for inspection.";
    [self retainDemoOutcome:@"uncertain" message:message request:_demoRequest];_demoCopyFeedback.toolTip=nil;_demoCopyFeedback.stringValue=message;[self update];
    if(_demoQuitPending&&!_demoUncertainQuitPrompting){_demoQuitPending=NO;[self completeDemoQuit];}return;
  }
  if(!_demoOperation.finished)return;
  CRDemoOperation *operation=_demoOperation;NSDictionary *request=_demoRequest;_demoOperation=nil;_demoRequest=nil;[_demoOperationTimer invalidate];_demoOperationTimer=nil;
  BOOL current=[self demoBindingCurrent:request[@"binding"]],samePanel=[_demoPanelIdentity isEqual:request[@"panel"]],visible=current&&samePanel;
  if(samePanel)_demoCopyFeedback.toolTip=nil;
  if(current&&!_demoQuitPending){
    @try{
      if(!operation.success){NSString *message=[self demoFailureMessage:operation request:request];[self retainDemoOutcome:operation.cancelled||operation.failure.length?@"uncertain":@"failed" message:message request:request];if(visible)_demoCopyFeedback.stringValue=message;}else{
        NSDictionary *result=[NSJSONSerialization JSONObjectWithData:operation.output options:0 error:nil];if(![result isKindOfClass:NSDictionary.class])CRFail();
        if([request[@"kind"] isEqual:@"inspect"]){
          NSString *vendor=request[@"vendor"],*version=[vendor isEqual:@"codex"]?@"0.160.0":@"2.1.299";
          if(!CRExact(result,@[@"path",@"sha256",@"version"])||![result[@"path"] isKindOfClass:NSString.class]||![result[@"path"] isAbsolutePath]||[result[@"path"] length]>4096||!CRPattern(result[@"sha256"],@"[a-f0-9]{64}")||![result[@"version"] isEqual:version])CRFail();
          [[self demoDefaults] setObject:result forKey:[self demoChoiceKey:vendor]];_demoChoices[vendor]=result;if(visible)_demoCopyCommands=[self demoSetupCommands];
          if([request[@"action"] isEqual:@"choose"]){if(visible)_demoCopyFeedback.stringValue=[NSString stringWithFormat:@"Saved %@ %@. It will be checked again each time.",vendor,version];}
          else [self handoffDemoClient:result request:request];
        }else if([request[@"kind"] isEqual:@"prepare"]){
          if(![result[@"status"] isEqual:@"proposed"]||!CRPattern(result[@"proposalSha256"],@"[a-f0-9]{64}")||![result[@"store"] isEqual:request[@"binding"][@"store"]]||![result[@"generation"] isEqual:request[@"binding"][@"generation"]]||![result[@"endpoint"] isEqual:request[@"binding"][@"endpoint"]]||![result[@"review"] isKindOfClass:NSDictionary.class]||![result[@"proposal"] isKindOfClass:NSString.class])CRFail();
          [self retainDemoOutcome:@"prepared" message:@"Desktop setup was prepared. Prepare again to review a fresh proposal in this panel. No config has changed." request:request];
          if(visible){_demoProposal=result;_demoClosed.state=NSControlStateValueOff;_demoReview.stringValue=[NSString stringWithFormat:@"%@ entry %@\n%@\n%@",[result[@"review"][@"operation"] capitalizedString],result[@"entryName"],result[@"config"],result[@"review"][@"backup"]];_demoCopyFeedback.stringValue=@"Review the exact change, close Desktop and config editors, then confirm below. No config has changed.";}
        }else if([request[@"kind"] isEqual:@"apply"]){if(![result[@"status"] isEqual:@"applied"])CRFail();NSString *message=@"Setup applied; connection is not yet confirmed. Start Claude Desktop normally with a fresh conversation.";[self retainDemoOutcome:@"applied" message:message request:request];if(visible){_demoProposal=nil;_demoClosed.state=NSControlStateValueOff;_demoReview.stringValue=@"Configuration applied. Start Claude Desktop normally and begin a fresh conversation.";_demoCopyFeedback.stringValue=message;}}
      }
    }@catch(NSException *error){(void)error;NSString *message=@"Setup result could not be verified. Retain state and reopen setup; do not replay an uncertain apply.";[self retainDemoOutcome:@"uncertain" message:message request:request];if(visible){_demoProposal=nil;_demoClosed.state=NSControlStateValueOff;_demoCopyFeedback.stringValue=message;}}
  }else if(samePanel)_demoCopyFeedback.stringValue=@"Demo changed. Reopen Demo setup for current actions.";
  [self update];if(_demoQuitPending){_demoQuitPending=NO;[self completeDemoQuit];}
}
- (NSArray<NSString *> *)demoSetupCommands {
  NSString *(^quote)(NSString *)=^NSString *(NSString *v){return [NSString stringWithFormat:@"'%@'",[v stringByReplacingOccurrencesOfString:@"'" withString:@"'\"'\"'"]];};
  NSString *base=[NSString stringWithFormat:@"%@ demo --root %@ --store %@ --generation %@ --endpoint %@",quote([_bundle stringByAppendingPathComponent:@"Contents/MacOS/context-router"]),quote(_root),quote(_storeId),quote(_generation),quote(_mcpOrigin)];
  NSMutableArray *commands=[NSMutableArray array];
  NSArray *actions=@[@"login A",@"launch A",@"login B --client claude --auth subscription",@"launch B --client claude --auth subscription",@"desktop prepare",@"status"];
  for(NSUInteger i=0;i<actions.count;i++){NSString *executable=i<4?_demoChoices[i<2?@"codex":@"claude"][@"path"]:nil;[commands addObject:[NSString stringWithFormat:@"%@ %@%@",base,actions[i],executable?[@" --executable " stringByAppendingString:quote(executable)]:@""]];}
  return commands;
}
- (NSDictionary *)demoSetupContext {
  if(!_ready||_stopped||_stopping||_broken||_quitting||!_guardian.running||![_mode isEqual:@"demo"]||!_root||!_storeId||!_generation||!_mcpOrigin)return nil;
  return @{@"root":_root,@"store":_storeId,@"generation":_generation,@"endpoint":_mcpOrigin};
}
- (NSPasteboard *)demoSetupPasteboard {return NSPasteboard.generalPasteboard;}
- (void)copyDemoCommand:(NSButton *)sender {
  _demoCopyFeedback.toolTip=nil;
  NSDictionary *current=[self demoSetupContext];
  if(!current||![_demoCopyBinding isEqualToDictionary:current]){_demoCopyFeedback.stringValue=@"Nothing copied. Reopen Demo setup for current commands.";return;}
  NSInteger index=sender.tag;if(index<0||index>=(NSInteger)_demoCopyCommands.count)return;
  BOOL copied=NO;@try{NSPasteboard *pasteboard=[self demoSetupPasteboard];copied=[pasteboard clearContents]>=0&&[pasteboard setString:_demoCopyCommands[index] forType:NSPasteboardTypeString];}@catch(NSException *error){(void)error;}
  _demoCopyFeedback.stringValue=copied?[NSString stringWithFormat:@"Copied %@. Paste it into Terminal.",_demoCopyNames[index]]:@"Could not copy. Try the Copy button again.";
}
- (NSAlert *)demoSetupAlert {
  _demoCopyBinding=[self demoSetupContext];if(!_demoCopyBinding)return nil;_demoPanelIdentity=CRRandom(16);_demoProposal=nil;_demoChoices=[NSMutableDictionary dictionary];_demoActions=[NSMutableArray array];
  if(_demoOutcome&&![_demoOutcome[@"binding"] isEqual:_demoCopyBinding])_demoOutcome=nil;
  for(NSString *vendor in @[@"codex",@"claude"]){id saved=[[self demoDefaults] objectForKey:[self demoChoiceKey:vendor]];if([saved isKindOfClass:NSDictionary.class]&&CRExact(saved,@[@"path",@"sha256",@"version"])&&[saved[@"path"] isKindOfClass:NSString.class]&&[saved[@"path"] isAbsolutePath]&&[saved[@"path"] length]<=4096&&[saved[@"path"] rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound&&CRPattern(saved[@"sha256"],@"[a-f0-9]{64}")&&[saved[@"version"] isKindOfClass:NSString.class])_demoChoices[vendor]=saved;}
  _demoCopyCommands=[self demoSetupCommands];_demoCopyNames=@[@"Codex A sign-in",@"Codex A launch",@"Claude Code B sign-in",@"Claude Code B launch",@"Claude Desktop C setup",@"Demo status"];
  NSAlert *alert=[NSAlert new];alert.messageText=@"Demo setup";alert.informativeText=@"Sign in or open an assistant in Terminal. Providers may receive demo context. Start a fresh conversation; connection is confirmed in the assistant.";
  NSView *view=[[NSView alloc] initWithFrame:NSMakeRect(0,0,660,660)];
  NSTextField *(^label)(NSView *,NSString *,NSRect)=^NSTextField *(NSView *parent,NSString *text,NSRect frame){NSTextField *field=[NSTextField labelWithString:text];field.frame=frame;field.font=[NSFont systemFontOfSize:12];field.lineBreakMode=NSLineBreakByWordWrapping;field.selectable=YES;[parent addSubview:field];return field;};
  NSView *(^group)(NSString *,NSRect)=^NSView *(NSString *title,NSRect frame){NSBox *box=[[NSBox alloc] initWithFrame:frame];box.title=title;box.titleFont=[NSFont boldSystemFontOfSize:13];[view addSubview:box];return box.contentView;};
  NSArray *ids=@[@"demo-copy-login-a",@"demo-copy-launch-a",@"demo-copy-login-b",@"demo-copy-launch-b",@"demo-copy-desktop",@"demo-copy-status"];
  void (^copy)(NSView *,NSString *,NSInteger,NSRect)=^(NSView *parent,NSString *title,NSInteger index,NSRect frame){NSButton *button=[NSButton buttonWithTitle:title target:self action:@selector(copyDemoCommand:)];button.frame=frame;button.tag=index;button.identifier=ids[index];button.accessibilityLabel=[@"Copy " stringByAppendingString:self->_demoCopyNames[index]];[parent addSubview:button];};
  NSButton *(^button)(NSView *,NSString *,NSString *,SEL,NSInteger,NSRect)=^NSButton *(NSView *parent,NSString *title,NSString *identifier,SEL action,NSInteger tag,NSRect frame){NSButton *control=[NSButton buttonWithTitle:title target:self action:action];control.frame=frame;control.identifier=identifier;control.tag=tag;[parent addSubview:control];[self->_demoActions addObject:control];return control;};
  for(NSUInteger i=0;i<2;i++){
    NSView *client=group(i?@"Claude Code · Agent B":@"Codex · Agent A",NSMakeRect(0,535-i*120,660,112));
    label(client,i?@"Subscription reader · health and finance excluded":@"Writer · approve each intended change",NSMakeRect(8,68,620,20));
    button(client,@"Sign in",i?@"demo-login-b":@"demo-login-a",@selector(demoClientAction:),i*3,NSMakeRect(4,32,100,30));
    button(client,@"Open",i?@"demo-open-b":@"demo-open-a",@selector(demoClientAction:),i*3+1,NSMakeRect(112,32,100,30));
    NSButton *choose=button(client,@"Choose executable…",i?@"demo-choose-b":@"demo-choose-a",@selector(demoClientAction:),i*3+2,NSMakeRect(220,32,190,30));choose.toolTip=_demoChoices[i?@"claude":@"codex"][@"path"]?:@"Choose a qualified native executable if automatic discovery is unavailable.";
    copy(client,@"Copy sign-in",i*2,NSMakeRect(4,2,140,26));copy(client,@"Copy launch",i*2+1,NSMakeRect(152,2,140,26));
  }
  NSView *desktop=group(@"Claude Desktop · Agent C",NSMakeRect(0,118,660,287));
  label(desktop,@"Reader · health and finance excluded",NSMakeRect(8,241,620,20));
  button(desktop,@"Prepare setup",@"demo-desktop-prepare",@selector(prepareDemoDesktop:),0,NSMakeRect(4,205,160,30));
  _demoReview=label(desktop,@"Prepare a proposal, review its exact entry, then explicitly apply.\nDesktop and configuration editors must be closed before applying.",NSMakeRect(8,116,620,82));_demoReview.identifier=@"demo-desktop-review";
  _demoDetails=button(desktop,@"View exact change…",@"demo-desktop-details",@selector(showDemoDetails:),0,NSMakeRect(4,82,190,30));
  _demoClosed=[NSButton checkboxWithTitle:@"Claude Desktop and all config editors are closed" target:self action:@selector(demoClosedChanged:)];_demoClosed.frame=NSMakeRect(8,48,620,26);_demoClosed.identifier=@"demo-desktop-closed";[desktop addSubview:_demoClosed];
  _demoApply=button(desktop,@"Apply reviewed change",@"demo-desktop-apply",@selector(applyDemoDesktop:),0,NSMakeRect(4,8,210,30));copy(desktop,@"Copy setup command",4,NSMakeRect(325,8,210,30));
  copy(view,@"Copy status",5,NSMakeRect(0,82,140,28));label(view,@"Checks native demo readiness, not an assistant connection.",NSMakeRect(152,86,500,20));
  NSTextField *endpoint=label(view,[NSString stringWithFormat:@"Endpoint: %@ · historical sample 2024–2025",_mcpOrigin],NSMakeRect(0,59,660,18));endpoint.font=[NSFont systemFontOfSize:11];endpoint.textColor=NSColor.secondaryLabelColor;endpoint.toolTip=[NSString stringWithFormat:@"Store: %@\nRuntime: %@",_storeId,_generation];
  NSString *feedback=_demoOperation.ownershipLost?(_demoOperation.failure?:@"Setup ownership is uncertain. Retain state for inspection."):_demoOperation?@"Setup is still finishing. Actions will be available after it settles.":_demoOutcome?_demoOutcome[@"message"]:@"Choose an action. Copy commands remain available as a Terminal fallback.";
  _demoCopyFeedback=label(view,feedback,NSMakeRect(0,0,660,50));_demoCopyFeedback.identifier=@"demo-copy-feedback";
  alert.accessoryView=view;[alert addButtonWithTitle:@"Done"];[self updateDemoActions];return alert;
}
- (void)demoSetup:(id)sender {
  (void)sender;NSAlert *alert=[self demoSetupAlert];if(!alert)return;
  @try{[alert runModal];}@finally{
    _demoCopyBinding=nil;_demoCopyCommands=nil;_demoCopyNames=nil;_demoCopyFeedback=nil;_demoPanelIdentity=nil;_demoProposal=nil;_demoActions=nil;_demoReview=nil;_demoClosed=nil;_demoApply=nil;_demoDetails=nil;
  }
}
- (void)sleepWake:(NSNotification *)notification {(void)notification;_sleepInvalidated=YES;if(_ready&&!_stopping){[self send:@"model-unavailable"];_label.title=[NSString stringWithFormat:@"%@ · restart required after sleep",[_mode isEqual:@"demo"]?@"Demo ready":@"Dashboard ready"];}}
- (void)quit:(id)sender {(void)sender;[NSApp terminate:nil];}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)application {
  (void)application;if(_quitting)return _guardian.running?NSTerminateLater:NSTerminateNow;
  if(_demoUncertainQuitPrompting)return NSTerminateCancel;
  if(_demoOperation&&!_demoUncertainQuitConfirmed){
    if(_demoOperation.ownershipLost){
      [_demoOperationTimer invalidate];_demoOperationTimer=nil;_demoQuitPending=NO;
      _demoUncertainQuitPrompting=YES;BOOL confirmed=NO;@try{confirmed=[self confirmUncertainDemoQuit];}@finally{_demoUncertainQuitPrompting=NO;}
      if(!confirmed){[self update];return NSTerminateCancel;}_demoUncertainQuitConfirmed=YES;
      // Retain the operation and request. Confirmation permits only guardian
      // shutdown, never another helper signal/reap or an ownership claim.
    }else{_demoQuitPending=YES;[_demoOperation cancel:@"Quit requested. Setup is settling before the local runtime stops."];_demoCopyFeedback.stringValue=@"Finishing setup shutdown before Quit. Uncertain state is retained.";[self update];return NSTerminateCancel;}
  }
  if(!_guardian.running)return NSTerminateNow;_quitting=YES;_stopping=YES;_label.title=@"Stopping local runtime…";if(_generation)[self send:@"quit"];else @try{[_input.fileHandleForWriting closeFile];}@catch(NSException *e){(void)e;}[self update];return NSTerminateLater;
}
@end
int CRRunMenu(NSString *bundle,NSString *root,NSInteger uiPort,NSInteger mcpPort,NSInteger demoMcpPort){
  signal(SIGPIPE,SIG_IGN);NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyAccessory];
  __attribute__((objc_precise_lifetime)) CRMenu *delegate=[[CRMenu alloc] initWithBundle:bundle root:root?:CRDefaultRoot(YES) uiPort:uiPort mcpPort:mcpPort demoPort:demoMcpPort];app.delegate=delegate;[app run];return 0;
}
