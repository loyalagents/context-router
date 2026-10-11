#import "menu.m"
#include <sys/stat.h>

int main(int argc, const char *argv[]) { @autoreleasepool { @try {
  if (argc != 2) CRFail();
  NSString *root = [NSString stringWithUTF8String:argv[1]], *generation = @"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  NSString *exports = [[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation];
  NSString *file = [exports stringByAppendingPathComponent:@"unlock-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.token"];
  NSString *token = @"cr_ui_unlock_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n";
  if (![token writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil] || chmod(file.fileSystemRepresentation, 0600)) CRFail();
  CRMenu *menu = [[CRMenu alloc] initWithBundle:@"fixture" root:root];
  [menu setValue:generation forKey:@"generation"]; [menu setValue:@YES forKey:@"ready"];
  if (![menu unlock:file] || ![[menu code] isEqual:[token substringToIndex:token.length-1]]) CRFail();
  if (![@"s" writeToFile:@CR_CLOCK_MARKER atomically:NO encoding:NSUTF8StringEncoding error:nil]) CRFail();
  BOOL expired = NO;
  @try { (void)[menu code]; } @catch (NSException *e) { (void)e; expired = YES; }
  if (!expired) CRFail();
  puts("sleep-expired-unlock"); return 0;
} @catch (NSException *e) { (void)e; return 1; } } }
