#import <AppKit/AppKit.h>
#import "menu.h"
#import "maintenance.h"
#import "process.h"
#import "unlock-file.h"
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>
@interface CRMenu : NSObject <NSApplicationDelegate>
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root;
@end
@implementation CRMenu {
  NSString *_bundle,*_root,*_generation,*_origin,*_unlockFile;
  NSStatusItem *_status;NSMenuItem *_label;NSMutableDictionary<NSString *,NSMenuItem *> *_items;
  NSTask *_guardian;NSPipe *_input,*_output;CRWriteQueue *_commands;CRFrames *_frames;NSTimer *_timer;
  BOOL _ready,_stopping,_quitting,_stopped,_broken,_download,_cancelPending,_sleepInvalidated,_openOnReady,_exitObserved;double _unlockUntil;
}
- (instancetype)initWithBundle:(NSString *)bundle root:(NSString *)root {
  self=[super init];if(self){_bundle=bundle;_root=root;_items=[NSMutableDictionary dictionary];_openOnReady=YES;}return self;
}
- (void)add:(NSString *)title action:(SEL)action key:(NSString *)key menu:(NSMenu *)menu {
  NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];item.target=self;[menu addItem:item];_items[key]=item;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;_status=[[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];_status.button.title=@"CR";_status.button.toolTip=@"Context Router private Mac pilot";
  NSMenu *menu=[NSMenu new];menu.autoenablesItems=NO;_label=[[NSMenuItem alloc] initWithTitle:@"Starting local runtime…" action:nil keyEquivalent:@""];_label.enabled=NO;[menu addItem:_label];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Open dashboard" action:@selector(openDashboard:) key:@"open" menu:menu];[self add:@"New unlock code…" action:@selector(newUnlock:) key:@"unlock" menu:menu];[self add:@"Copy unlock code" action:@selector(copyUnlock:) key:@"copy" menu:menu];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Download Qwen3.5 9B model…" action:@selector(downloadModel:) key:@"download" menu:menu];[self add:@"Cancel download" action:@selector(cancelDownload:) key:@"cancel" menu:menu];[menu addItem:[NSMenuItem separatorItem]];
  [self add:@"Restart local runtime…" action:@selector(restart:) key:@"restart" menu:menu];[self add:@"Quit Context Router" action:@selector(quit:) key:@"quit" menu:menu];_status.menu=menu;
  NSNotificationCenter *center=NSWorkspace.sharedWorkspace.notificationCenter;
  [center addObserver:self selector:@selector(sleepWake:) name:NSWorkspaceWillSleepNotification object:nil];[center addObserver:self selector:@selector(sleepWake:) name:NSWorkspaceDidWakeNotification object:nil];
  @try {
    _input=[NSPipe pipe];_output=[NSPipe pipe];_frames=[CRFrames new];_guardian=[NSTask new];
    _guardian.executableURL=[NSURL fileURLWithPath:[_bundle stringByAppendingPathComponent:@"Contents/MacOS/context-router"]];
    _guardian.arguments=@[@"guardian",@"--root",_root,@"--ui-port",@"0",@"--mcp-port",@"8787"];_guardian.environment=@{};_guardian.currentDirectoryURL=[NSURL fileURLWithPath:_bundle];
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
  BOOL active=_ready&&!_stopping&&!_broken&&_guardian.running;
  for(NSString *key in @[@"open",@"unlock",@"restart"])_items[key].enabled=active;
  _items[@"copy"].enabled=active&&_unlockFile&&CRNow()<_unlockUntil;
  _items[@"download"].enabled=active&&!_download;_items[@"cancel"].enabled=active&&_download&&!_cancelPending;_items[@"quit"].enabled=!_quitting;
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
  _unlockFile=value;_unlockUntil=CRNow()+300;return YES;
}
- (void)record:(NSDictionary *)record {
  if(!CRInteger(record[@"version"],1,1)||!CRPattern(record[@"generation"],@"[a-f0-9]{32}"))CRFail();NSString *type=record[@"type"];
  if([type isEqual:@"starting"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"phase"])||![record[@"phase"] isEqual:@"preparing"]||(_generation&&!_stopped))CRFail();
    _generation=record[@"generation"];_ready=NO;_stopped=NO;_stopping=NO;_download=NO;_cancelPending=NO;_origin=nil;_unlockFile=nil;_label.title=@"Starting local runtime…";return;
  }
  if(!_generation||![record[@"generation"] isEqual:_generation]||_stopped)CRFail();
  if([type isEqual:@"ready"]){
    if(_ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"mcpOrigin",@"unlockFile",@"modelEnabled"])||CFGetTypeID((__bridge CFTypeRef)record[@"modelEnabled"])!=CFBooleanGetTypeID()||!CRPattern(record[@"mcpOrigin"],@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}/mcp")||[NSURL URLWithString:record[@"mcpOrigin"]].port.integerValue>65535)CRFail();
    [self origin:record[@"origin"]];[self unlock:record[@"unlockFile"]];_ready=YES;
    if(!_stopping&&!_quitting){_label.title=[record[@"modelEnabled"] boolValue]?@"Dashboard ready · AI loading":@"Dashboard ready · model not installed";if(_sleepInvalidated)[self send:@"model-unavailable"];}
    if(_quitting){_stopping=YES;[self send:@"quit"];}
    else if(!_stopping&&!_broken&&_openOnReady){_openOnReady=NO;[self openDashboard:nil];}
  }else if([type isEqual:@"unlock"]){
    if(!_ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"unlockFile"])||![_origin isEqual:record[@"origin"]])CRFail();if([self unlock:record[@"unlockFile"]])[self performSelector:@selector(showUnlock) withObject:nil afterDelay:0];
  }else if([type isEqual:@"model-status"]){
    if(!CRExact(record,@[@"version",@"generation",@"type",@"state"])||![@[@"available",@"busy",@"loading",@"unavailable"] containsObject:record[@"state"]])CRFail();
    _label.title=[record[@"state"] isEqual:@"available"]?@"Dashboard ready · AI available":[record[@"state"] isEqual:@"busy"]?@"Dashboard ready · AI working":[record[@"state"] isEqual:@"loading"]?@"Dashboard ready · AI loading":@"Dashboard ready · restart required for AI";
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
  if(!_ready||_stopping||_quitting||!_unlockFile||CRNow()>=_unlockUntil)CRFail();NSString *exports=_unlockFile.stringByDeletingLastPathComponent;(void)CRPrivatePin(exports,YES);
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
- (void)downloadModel:(id)sender {
  (void)sender;NSAlert *alert=[NSAlert new];alert.messageText=@"Download Qwen3.5 9B?";alert.informativeText=@"Download the pinned Q4_K_M model (5,680,522,464 bytes, about 5.7 GB) from unsloth on Hugging Face for local AI. Allow at least 6.8 GB free space. The dashboard stays available. A runtime restart is required afterward.";[alert addButtonWithTitle:@"Download"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]==NSAlertFirstButtonReturn&&_ready&&!_stopping){_download=YES;[self send:@"download"];}[self update];
}
- (void)cancelDownload:(id)sender {(void)sender;if(_download&&!_cancelPending){_cancelPending=YES;[self send:@"cancel-download"];}[self update];}
- (void)beginRestart {_sleepInvalidated=NO;_openOnReady=YES;_stopping=YES;_label.title=@"Stopping local runtime…";[self send:@"restart"];[self update];}
- (void)restart:(id)sender {
  (void)sender;NSAlert *alert=[NSAlert new];alert.messageText=@"Restart local runtime?";alert.informativeText=@"This signs out browser sessions, interrupts MCP connections, drains current work, and starts a fresh local AI session. The current dashboard will open when ready; unlock there with a new code. Older tabs may have an obsolete address. Data, identity, client credentials and installed model assets are preserved.";[alert addButtonWithTitle:@"Restart"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]==NSAlertFirstButtonReturn&&_ready&&!_stopping)[self beginRestart];[self update];
}
- (void)sleepWake:(NSNotification *)notification {(void)notification;_sleepInvalidated=YES;if(_ready&&!_stopping){[self send:@"model-unavailable"];_label.title=@"Dashboard ready · restart required after sleep";}}
- (void)quit:(id)sender {(void)sender;[NSApp terminate:nil];}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)application {
  (void)application;if(!_guardian.running)return NSTerminateNow;_quitting=YES;_stopping=YES;_label.title=@"Stopping local runtime…";if(_generation)[self send:@"quit"];else @try{[_input.fileHandleForWriting closeFile];}@catch(NSException *e){(void)e;}[self update];return NSTerminateLater;
}
@end
int CRRunMenu(NSString *bundle,NSString *root){
  signal(SIGPIPE,SIG_IGN);NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyAccessory];
  __attribute__((objc_precise_lifetime)) CRMenu *delegate=[[CRMenu alloc] initWithBundle:bundle root:root?:CRDefaultRoot(YES)];app.delegate=delegate;[app run];return 0;
}
