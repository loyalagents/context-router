// P1 finite synthetic menu/pipe probe. No personal installation or browser action.
#import <AppKit/AppKit.h>
#include <unistd.h>
#include <signal.h>

@interface ProbeDelegate : NSObject <NSApplicationDelegate>
@property NSTask *guardian;
@property NSPipe *control;
@property NSStatusItem *status;
@property NSMenu *menu;
@property NSMutableData *pending;
@property BOOL outputEnded;
@property BOOL guardianEnded;
@property BOOL sentQuit;
@property NSUInteger bytes;
@property int result;
@end

@implementation ProbeDelegate
- (void)finishIfReady {
  if (!self.outputEnded || !self.guardianEnded) return;
  self.result = self.guardian.terminationStatus;
  puts("{\"event\":\"native-guardian-reaped\"}");
  [NSApp stop:nil];
  [NSApp postEvent:[NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint
      modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:0 data1:0 data2:0] atStart:NO];
}
- (void)restartFixture:(id)sender {
  (void)sender;
  if (!self.sentQuit && self.guardian.running)
    [self.control.fileHandleForWriting writeData:[@"restart\n" dataUsingEncoding:NSUTF8StringEncoding]];
}
- (void)quitFixture:(id)sender {
  (void)sender;
  if (self.sentQuit) return;
  self.sentQuit = YES;
  [self.control.fileHandleForWriting closeFile]; // Guardian owns shutdown/reaping on EOF.
}
- (void)consume:(NSData *)data {
  if (data.length == 0) { self.outputEnded = YES; [self finishIfReady]; return; }
  self.bytes += data.length;
  if (self.bytes > 16384) { self.result = 9; [self quitFixture:nil]; return; }
  fwrite(data.bytes, 1, data.length, stdout);
  [self.pending appendData:data];
  NSData *separator = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
  while (YES) {
    NSRange found = [self.pending rangeOfData:separator options:0 range:NSMakeRange(0, self.pending.length)];
    if (found.location == NSNotFound) break;
    NSData *line = [self.pending subdataWithRange:NSMakeRange(0, found.location)];
    [self.pending replaceBytesInRange:NSMakeRange(0, found.location + 1) withBytes:NULL length:0];
    NSDictionary *record = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
    if ([record[@"event"] isEqual:@"fixture-ready"] && [record[@"role"] isEqual:@"parser"]) {
      if ([record[@"generation"] intValue] == 1) [self.menu performActionForItemAtIndex:0];
      else if ([record[@"generation"] intValue] == 2) [self.menu performActionForItemAtIndex:1];
    }
  }
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  self.pending = [NSMutableData data];
  self.status = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  self.status.button.title = @"Context Router P1";
  self.menu = [[NSMenu alloc] initWithTitle:@"Context Router P1 fixture"];
  for (NSArray *item in @[@[@"Restart fixture", NSStringFromSelector(@selector(restartFixture:))],
                          @[@"Quit fixture", NSStringFromSelector(@selector(quitFixture:))]]) {
    NSMenuItem *entry = [[NSMenuItem alloc] initWithTitle:item[0] action:NSSelectorFromString(item[1]) keyEquivalent:@""];
    entry.target = self; [self.menu addItem:entry];
  }
  self.status.menu = self.menu;
  self.guardian = [[NSTask alloc] init];
  self.guardian.executableURL = [NSURL fileURLWithPath:args[1]];
  self.guardian.arguments = @[@"guardian", args[2], args[3], args[4]];
  self.control = [NSPipe pipe];
  NSPipe *output = [NSPipe pipe];
  self.guardian.standardInput = self.control;
  self.guardian.standardOutput = output;
  self.guardian.standardError = NSFileHandle.fileHandleWithStandardError;
  __weak ProbeDelegate *weakSelf = self;
  output.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length == 0) handle.readabilityHandler = nil;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf consume:data]; });
  };
  self.guardian.terminationHandler = ^(NSTask *task) {
    (void)task;
    dispatch_async(dispatch_get_main_queue(), ^{ weakSelf.guardianEnded = YES; [weakSelf finishIfReady]; });
  };
  NSError *error;
  if (![self.guardian launchAndReturnError:&error]) { self.result = 9; [NSApp stop:nil]; return; }
  puts("{\"event\":\"native-menu-ready\"}");
  [NSTimer scheduledTimerWithTimeInterval:10 repeats:NO block:^(NSTimer *timer) { (void)timer; [weakSelf quitFixture:nil]; }];
}
@end

int main(int argc, const char **argv) {
  (void)argv;
  if (argc != 5) return 9;
  // Covers WindowServer/AppKit initialization before an event-loop timer exists.
  alarm(20);
  setvbuf(stdout, NULL, _IONBF, 0);
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
    ProbeDelegate *delegate = [[ProbeDelegate alloc] init];
    app.delegate = delegate;
    [app run];
    return delegate.result;
  }
}
