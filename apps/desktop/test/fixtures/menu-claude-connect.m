#import "menu.m"
#include <stdio.h>
@interface ConnectGuardian : NSObject
@property(nonatomic,getter=isRunning) BOOL running;
@end
@implementation ConnectGuardian
@end
@interface ConnectOperation : NSObject
@property BOOL finished,success,cancelled,ownershipLost;
@property(strong) NSData *output,*errorOutput;
@property(strong) NSString *failure;
- (void)pump;
@end
@implementation ConnectOperation
- (void)pump {}
@end
@interface ConnectMenu : CRMenu
@property(strong) NSString *picked,*terminal;
@property(strong) NSUserDefaults *defaults;
@property(strong) NSMutableArray *states;
@property(strong) NSArray *arguments;
@property(strong) ConnectOperation *operation;
@property NSUInteger picks;
@property BOOL stale;
@end
@implementation ConnectMenu
- (NSUserDefaults *)demoDefaults {return self.defaults;}
- (NSString *)chooseClaudeProject {self.picks++;if(self.stale)[self setValue:@"cccccccccccccccccccccccccccccccc" forKey:@"generation"];return self.picked;}
- (void)sendClaudeStatus:(NSString *)state request:(NSDictionary *)request {if([self demoBindingCurrent:request[@"binding"]])[self.states addObject:state];}
- (CRDemoOperation *)demoOperationWithArguments:(NSArray *)arguments {self.arguments=arguments;self.operation=[ConnectOperation new];return (CRDemoOperation *)self.operation;}
- (void)openDemoTerminal:(NSString *)file completion:(void (^)(BOOL))completion {self.terminal=file;completion(YES);}
@end
static void check(BOOL value){if(!value)@throw [NSException exceptionWithName:@"fixture" reason:@"Claude connect assertion failed" userInfo:nil];}
int main(int argc,const char *argv[]){@autoreleasepool{@try{
 if(argc!=3)CRFail();[NSApplication sharedApplication];NSString *root=@(argv[1]),*project=@(argv[2]),*generation=@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
 ConnectMenu *menu=[[ConnectMenu alloc] initWithBundle:@"/synthetic/Context Router.app" root:root];menu.states=[NSMutableArray array];menu.picked=project;
 NSString *domain=[@"cr-connect-fixture-" stringByAppendingString:CRRandom(8)];menu.defaults=[[NSUserDefaults alloc] initWithSuiteName:domain];
 ConnectGuardian *guardian=[ConnectGuardian new];guardian.running=YES;[menu setValue:guardian forKey:@"guardian"];[menu setValue:@YES forKey:@"ready"];[menu setValue:@"demo" forKey:@"mode"];[menu setValue:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" forKey:@"storeId"];[menu setValue:generation forKey:@"generation"];[menu setValue:@"http://127.0.0.1:3211/mcp" forKey:@"mcpOrigin"];
 NSDictionary *request=@{@"id":@"dddddddddddddddddddddddddddddddd",@"binding":[menu demoSetupContext],@"chooseProject":@NO};
 [menu openDashboardClaude:request];check(menu.picks==1&&[menu.states.lastObject isEqual:@"checking"]);check([menu.arguments containsObject:@"inspect"]&&![menu.arguments containsObject:project]);
 menu.operation.output=[NSJSONSerialization dataWithJSONObject:@{@"path":@"/native/claude",@"version":@"2.1.299",@"sha256":[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0]} options:0 error:nil];menu.operation.finished=YES;menu.operation.success=YES;
 [menu pollDemoOperation:nil];check([menu.states.lastObject isEqual:@"terminal-opened"]);NSString *script=[NSString stringWithContentsOfFile:menu.terminal encoding:NSUTF8StringEncoding error:nil];check([script containsString:@"'connect' 'B'"]&&[script containsString:@"'--project'"]&&[script containsString:@"'--request' 'dddddddddddddddddddddddddddddddd'"]&&![script containsString:@"CR_DEMO_TOKEN"]);
 [menu openDashboardClaude:request];check(menu.picks==1);[menu setValue:nil forKey:@"demoOperation"];
 menu.picked=nil;NSMutableDictionary *change=[request mutableCopy];change[@"chooseProject"]=@YES;[menu openDashboardClaude:change];check([menu.states.lastObject isEqual:@"cancelled"]);
 menu.stale=YES;menu.picked=project;NSUInteger count=menu.states.count;[menu openDashboardClaude:change];check(menu.states.count==count+1&&[menu valueForKey:@"demoOperation"]==nil);
 [menu.defaults removePersistentDomainForName:domain];puts("{\"projectRemembered\":true,\"terminalBound\":true,\"cancelled\":true,\"staleRefused\":true}");return 0;
 }@catch(NSException *error){fprintf(stderr,"%s\n",error.reason.UTF8String);return 1;}}}
