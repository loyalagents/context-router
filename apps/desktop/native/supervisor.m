#import "supervisor.h"
#import "process.h"
#import "diagnostics.h"
#import "demo-ready.h"
#import "unlock-file.h"
#include <sys/socket.h>
#include <sys/stat.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>
static volatile sig_atomic_t interrupted=0;
static void stopSignal(int number){(void)number;interrupted=1;}
static void requestedPortAvailable(NSInteger port){
  if(!port)return;
  int fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0)CRFail();
  int reuse=1;struct sockaddr_in address={.sin_len=sizeof(address),.sin_family=AF_INET,.sin_port=htons((uint16_t)port),.sin_addr={.s_addr=htonl(INADDR_LOOPBACK)}};
  // Match Node's SO_REUSEADDR so a clean restart tolerates its prior TIME_WAIT.
  int result=setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&reuse,sizeof(reuse))||bind(fd,(struct sockaddr *)&address,sizeof(address));
  close(fd);if(result)CRFail();
}
static NSInteger vacantPort(void){
  int fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0)CRFail();
  struct sockaddr_in address={.sin_len=sizeof(address),.sin_family=AF_INET,.sin_port=0,.sin_addr={.s_addr=htonl(INADDR_LOOPBACK)}};
  socklen_t size=sizeof(address);int result=bind(fd,(struct sockaddr *)&address,size)||getsockname(fd,(struct sockaddr *)&address,&size);close(fd);
  if(result)CRFail();return ntohs(address.sin_port);
}
static void emit(CRWriteQueue *output,NSString *generation,NSString *type,NSDictionary *payload){
  NSMutableDictionary *record=[@{@"version":@1,@"generation":generation,@"type":type} mutableCopy];[record addEntriesFromDictionary:payload?:@{}];
  NSMutableData *data=[[NSJSONSerialization dataWithJSONObject:record options:0 error:nil] mutableCopy];if(!data||data.length>16383)CRFail();[data appendBytes:"\n" length:1];
  // Shell delivery is independent of the private child protocol and drain proof.
  @try{[output append:data];}@catch(NSException *e){(void)e;[output discard];}
}
static NSArray *nodeArgs(NSString *resources,NSString *role,NSArray *extra){
  return [@[@"--no-global-search-paths",[[resources stringByAppendingPathComponent:@"desktop/runtime"] stringByAppendingPathComponent:[role stringByAppendingString:@".mjs"]]] arrayByAddingObjectsFromArray:extra];
}
static NSArray *modelArgs(NSString *root,NSString *session,NSInteger port){
  return @[@"--model",[[root stringByAppendingPathComponent:@"models"] stringByAppendingPathComponent:@"Qwen3.5-9B-Q4_K_M.gguf"],@"--host",@"127.0.0.1",@"--port",[@(port) stringValue],@"--alias",@"step06-qwen35",
    @"--ctx-size",@"16384",@"--parallel",@"1",@"--gpu-layers",@"all",@"--flash-attn",@"on",@"--fit",@"off",@"--batch-size",@"512",@"--ubatch-size",@"512",@"--load-mode",@"mmap",@"--offline",
    @"--api-key-file",[session stringByAppendingPathComponent:@"api-key.txt"],@"--ssl-key-file",[session stringByAppendingPathComponent:@"server-key.pem"],@"--ssl-cert-file",[session stringByAppendingPathComponent:@"server-cert.pem"],
    @"--chat-template-kwargs",@"{\"enable_thinking\":false}",@"--no-webui",@"--slots",@"--no-context-shift",@"--cache-ram",@"0",@"--no-cache-idle-slots",@"--no-cache-prompt",@"--log-verbosity",@"3",@"--threads-http",@"4"];
}
static void common(NSDictionary *record,NSString *generation){if(!CRInteger(record[@"version"],1,1)||![record[@"generation"] isEqual:generation]||![record[@"type"] isKindOfClass:[NSString class]])CRFail();}
static void unlock(NSDictionary *record,NSString *exports){
  NSString *file=record[@"unlockFile"];
  if(![file isKindOfClass:[NSString class]]||![file.stringByDeletingLastPathComponent isEqual:exports]||!CRPattern(file.lastPathComponent,@"unlock-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.token"))CRFail();
}
static void origin(id value,NSInteger requested,BOOL mcp){
  NSString *expression=mcp?@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}/mcp":@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}";
  if(!CRPattern(value,expression))CRFail();NSURL *url=[NSURL URLWithString:value];NSInteger port=url.port.integerValue;
  if(port<1||port>65535||(requested&&port!=requested))CRFail();
}
// The finite seed child is a separate owned cohort. No selected-store metadata
// changes until its terminal acknowledgement, exact exit, and lock extinction.
static NSArray *demoCommands(CRFrames *shell,NSString *generation,NSString *priorGeneration){
  NSArray *commands=[shell readFrom:0];
  for(NSDictionary *c in commands)if(!CRExact(c,@[@"version",@"generation",@"command"])||!CRInteger(c[@"version"],1,1)||(![c[@"generation"] isEqual:generation]&&!([c[@"command"] isEqual:@"quit"]&&[c[@"generation"] isEqual:priorGeneration]))||![@[@"quit",@"cancel-demo",@"return-previous",@"retry-demo"] containsObject:c[@"command"]])CRFail();
  return commands;
}
// A return-only shell is available only after ordinary envelope admission or a
// completed cohort has proved quiescence. It neither retries demo nor repairs it.
static BOOL unavailableDemo(CREnvelope *owner,CRFrames *shell,CRWriteQueue *output,NSInteger personalMcpPort){
  [owner assertHeld];NSDictionary *state=owner.installation,*journal=CRReadJSON([owner.root stringByAppendingPathComponent:@"owner.json"],16384,YES);
  if(![state[@"mode"] isEqual:@"demo"]||![state[@"setup"] isEqual:@"ready"]||state[@"pendingDemo"]!=[NSNull null]||state[@"pendingRestore"]!=[NSNull null]||![journal[@"lifecycle"] isEqual:@"quiescent"]||[journal[@"outcome"] isEqual:@"uncertain"])CRFail();
  NSString *generation=CRRandom(16);emit(output,generation,@"starting",@{@"phase":@"demo-unavailable"});emit(output,generation,@"mode",@{@"mode":@"demo",@"storeId":state[@"selectedStore"]});
  while(YES){
    [owner assertHeld];[output flush];NSArray *commands=[shell readFrom:0];BOOL quit=NO,leave=NO;
    for(NSDictionary *c in commands){
      if(!CRExact(c,@[@"version",@"generation",@"command"])||!CRInteger(c[@"version"],1,1)||![c[@"generation"] isEqual:generation]||![@[@"quit",@"leave-demo"] containsObject:c[@"command"]])CRFail();
      if([c[@"command"] isEqual:@"quit"])quit=YES;else leave=YES;
    }
    if(quit||shell.ended||interrupted||output.discarded){emit(output,generation,@"stopped",@{@"outcome":@"ok"});[output flush];return NO;}
    if(leave){
      @try{requestedPortAvailable(personalMcpPort);}@catch(NSException *e){(void)e;emit(output,generation,@"transition-refused",nil);continue;}
      [owner selectMode:@"personal"];emit(output,generation,@"stopped",@{@"outcome":@"ok"});return YES;
    }
    usleep(10000);
  }
}
static BOOL prepareDemo(CREnvelope *owner,NSString *resources,CRFrames *shell,CRWriteQueue *output){
  // Quit can be queued against the last displayed generation before the shell
  // consumes the finite preparation starting frame. No other old command passes.
  NSString *priorGeneration=owner.generation;BOOL retry=YES;
  while(retry){
    retry=NO;BOOL cancelled=NO,quit=NO;NSString *generation=nil;
    if(owner.installation[@"pendingDemo"]==[NSNull null]){
      NSDictionary *seed=CRReadJSON([resources stringByAppendingPathComponent:@"demo-seed.json"],16384,NO);
      if(!CRExact(seed,@[@"version",@"sha256"]))CRFail();
      NSString *store=[owner reserveDemoWithSeed:seed[@"version"] hash:seed[@"sha256"]];
    NSDictionary *cap=[owner beginRole:@"demo-prepare" operation:@"initialize" store:store];generation=owner.generation;
      emit(output,generation,@"starting",@{@"phase":@"preparing-demo"});
      emit(output,generation,@"mode",@{@"mode":owner.installation[@"mode"],@"storeId":owner.installation[@"selectedStore"]});
      CRChild *child=[[CRChild alloc] initWithExecutable:[resources stringByAppendingPathComponent:@"bin/node"] arguments:nodeArgs(resources,@"demo-prepare",@[]) directory:[resources stringByAppendingPathComponent:@"app"] lock:owner.lockFD capability:cap role:@"demo-prepare"];
      [child command:@"start" generation:generation];NSNumber *terminal=nil;BOOL protocolFailed=NO,forced=NO;NSInteger stage=0;double deadline=CRLifecycleNow()+180;
      while(!child.exited){
        @try{
          [output flush];[owner assertHeld];
          for(NSDictionary *r in [child pump]){
            common(r,generation);
            if(terminal||!CRExact(r,@[@"version",@"generation",@"type",@"exitCode"])||![r[@"type"] isEqual:@"demo-complete"]||!CRInteger(r[@"exitCode"],0,1))CRFail();terminal=r[@"exitCode"];
          }
          for(NSDictionary *c in demoCommands(shell,generation,priorGeneration)){
            if([c[@"command"] isEqual:@"quit"])quit=YES;
            if(![@[@"quit",@"cancel-demo"] containsObject:c[@"command"]])CRFail();cancelled=YES;
          }
          if(shell.ended||interrupted||output.discarded){quit=YES;cancelled=YES;}
          if(child.protocolFailed||child.ownershipLost||(child.statusEnded&&!terminal&&!child.exited))CRFail();
        }@catch(NSException *e){(void)e;protocolFailed=YES;cancelled=YES;}
        if((cancelled||CRLifecycleNow()>=deadline)&&!stage&&!child.exited){cancelled=YES;stage=1;deadline=CRLifecycleNow()+15;@try{[child command:@"quit" generation:generation];}@catch(NSException *e){(void)e;protocolFailed=YES;}}
        if(stage&&CRLifecycleNow()>=deadline&&!child.exited){if(stage>=3)CRFail();forced=YES;[child signal:stage==1?SIGTERM:SIGKILL];stage++;deadline=CRLifecycleNow()+5;}
        if(!child.exited)usleep(10000);
      }
      // Consume cancellation queued during the final child observation before
      // committing selection. A complete-but-cancelled candidate stays retained.
      for(NSDictionary *c in demoCommands(shell,generation,priorGeneration)){cancelled=YES;if([c[@"command"] isEqual:@"quit"])quit=YES;}
      if(shell.ended||interrupted||output.discarded){quit=YES;cancelled=YES;}
      BOOL certain=!protocolFailed&&!forced&&!child.protocolFailed&&!child.ownershipLost&&terminal&&child.exitCode==terminal.intValue;
      BOOL okay=certain&&!cancelled&&child.success;
      [owner finishOutcome:certain?(okay?@"ok":@"failed"):@"uncertain"];
      if(!certain)CRFail();
      for(NSDictionary *c in demoCommands(shell,generation,priorGeneration)){cancelled=YES;if([c[@"command"] isEqual:@"quit"])quit=YES;}
      if(shell.ended||interrupted||output.discarded){quit=YES;cancelled=YES;}
      if(okay&&!cancelled){[owner publishDemo];emit(output,generation,@"stopped",@{@"outcome":@"ok"});return YES;}
      [owner failDemo];
    }else{
      if(![owner.installation[@"pendingDemo"][@"status"] isEqual:@"failed"])CRFail();
      generation=CRRandom(16);emit(output,generation,@"starting",@{@"phase":@"preparing-demo"});emit(output,generation,@"mode",@{@"mode":owner.installation[@"mode"],@"storeId":owner.installation[@"selectedStore"]});
    }
    emit(output,generation,@"demo-failed",nil);
    while(!quit&&!retry){
      [output flush];[owner assertHeld];
      for(NSDictionary *c in demoCommands(shell,generation,priorGeneration)){
        NSString *name=c[@"command"];
        if([name isEqual:@"quit"])quit=YES;
        else if([name isEqual:@"return-previous"]||[name isEqual:@"retry-demo"]){
          [owner retainFailedDemo];emit(output,generation,@"stopped",@{@"outcome":@"ok"});
          if([name isEqual:@"return-previous"])return YES;retry=YES;
        }
      }
      if(shell.ended||interrupted||output.discarded)quit=YES;
      if(!quit&&!retry)usleep(10000);
    }
    if(quit){emit(output,generation,@"stopped",@{@"outcome":@"failed"});[output flush];return NO;}
  }
  return YES;
}
int CRRunGuardian(NSString *bundle,NSString *root,NSInteger uiPort,NSInteger personalMcpPort,NSInteger demoMcpPort){
  umask(0077);signal(SIGPIPE,SIG_IGN);signal(SIGTERM,stopSignal);signal(SIGINT,stopSignal);signal(SIGCHLD,SIG_DFL);
  if(fcntl(0,F_SETFL,fcntl(0,F_GETFL)|O_NONBLOCK)||fcntl(1,F_SETFL,fcntl(1,F_GETFL)|O_NONBLOCK))CRFail();
  CRWriteQueue *output=[[CRWriteQueue alloc] initWithFD:1];
  CRFrames *shell=[CRFrames new];NSString *resources=[bundle stringByAppendingPathComponent:@"Contents/Resources"],*node=[resources stringByAppendingPathComponent:@"bin/node"],*directory=[resources stringByAppendingPathComponent:@"app"];
  BOOL again=YES;
  while(again){@autoreleasepool{
    again=NO;
    requestedPortAvailable(uiPort);
    // Read only to choose the preflight port; envelope admission below validates
    // the authoritative metadata. Refuse occupied ports before fresh setup writes.
    struct stat existing;NSString *preflightMode=@"personal";
    if(!lstat(root.fileSystemRepresentation,&existing))preflightMode=CRReadJSON([root stringByAppendingPathComponent:@"installation.json"],16384,YES)[@"mode"]?:@"personal";
    else if(errno!=ENOENT)CRFail();
    BOOL demoPortUnavailable=NO;
    @try{requestedPortAvailable([preflightMode isEqual:@"demo"]?demoMcpPort:personalMcpPort);}
    @catch(NSException *e){(void)e;if(![preflightMode isEqual:@"demo"])CRFail();demoPortUnavailable=YES;}
    CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root allowFresh:!demoPortUnavailable];
    if(!owner.fresh&&![owner.installation[@"setup"] isEqual:@"ready"])CRFail();
    if(demoPortUnavailable){if(!unavailableDemo(owner,shell,output,personalMcpPort))return 0;again=YES;continue;}
      if(owner.installation[@"pendingDemo"]!=[NSNull null]){if(!prepareDemo(owner,resources,shell,output))return 0;again=YES;continue;}
    NSInteger mcpPort=[owner.installation[@"mode"] isEqual:@"demo"]?demoMcpPort:personalMcpPort;
    requestedPortAvailable(uiPort);
    @try{requestedPortAvailable(mcpPort);}@catch(NSException *e){(void)e;if(![owner.installation[@"mode"] isEqual:@"demo"])CRFail();if(!unavailableDemo(owner,shell,output,personalMcpPort))return 0;again=YES;continue;}
    NSString *modeAction=nil;
    NSDictionary *cap=[owner beginRole:@"prepare" operation:owner.fresh?@"initialize":@"verify" store:owner.installation[@"selectedStore"]];
    NSString *generation=owner.generation,*session=[[root stringByAppendingPathComponent:@"sessions"] stringByAppendingPathComponent:generation],*exports=[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation];
    NSMutableArray<CRChild *> *children=[NSMutableArray array];CRChild *prepare=nil,*app=nil,*model=nil,*download=nil;
    CRDemoReady *demoReady=nil;
    NSString *downloadTerminal=nil;BOOL downloadObserved=NO;long long downloadReceived=0;NSInteger downloadStage=0;double downloadDeadline=0;
    NSDictionary *prepared=nil;BOOL ready=NO,drained=NO,failed=NO,stopping=NO,restart=NO,quitRequested=NO,forcedApp=NO,appRecordsFailed=NO,modelStopped=NO,modelObserved=NO,prepareFailed=NO,controlFailed=NO;
    NSInteger stopStage=0,modelPort=vacantPort();double startupDeadline=CRLifecycleNow()+120,stopDeadline=0;
    @try{
      CRDiagnostic(owner,@"starting");
      CRPrivateDirectory(session,YES);CRPrivateDirectory(exports,YES);
      prepare=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"prepare",@[[ @(modelPort) stringValue]]) directory:directory lock:owner.lockFD capability:cap role:@"prepare"];
      [children addObject:prepare];[prepare command:@"start" generation:generation];emit(output,generation,@"starting",@{@"phase":@"preparing"});emit(output,generation,@"mode",@{@"mode":owner.installation[@"mode"],@"storeId":owner.installation[@"selectedStore"]});
    }@catch(NSException *exception){(void)exception;failed=YES;stopping=YES;}
    while(YES){@autoreleasepool{
      @try{[output flush];}@catch(NSException *e){(void)e;[output discard];}
      if(output.discarded){failed=YES;stopping=YES;restart=NO;}
      // Observe every exact child before a malformed peer can interrupt dispatch.
      NSMutableArray *batches=[NSMutableArray array];
      for(CRChild *child in children){
        @try{[batches addObject:@{@"child":child,@"messages":[child pump]}];}
        @catch(NSException *e){(void)e;failed=YES;stopping=YES;}
        if(child.protocolFailed||child.ownershipLost){failed=YES;stopping=YES;}
        if(child.exited&&child!=model&&![child.role isEqual:@"download"]&&!child.success)failed=YES;
        if(!stopping&&child==app&&child.statusEnded&&!drained&&!child.exited){failed=YES;stopping=YES;}
      }
        for(NSDictionary *batch in batches){
          CRChild *child=batch[@"child"];
          for(NSDictionary *record in batch[@"messages"]){
            @try{
            common(record,generation);NSString *type=record[@"type"];
            if(child==prepare&&[type isEqual:@"prepared"]){
              if(prepared||!CRExact(record,@[@"version",@"generation",@"type",@"targetId",@"modelEnabled",@"modelPort"])||!CRPattern(record[@"targetId"],@"[A-Za-z0-9_-]{43}")||CFGetTypeID((__bridge CFTypeRef)record[@"modelEnabled"])!=CFBooleanGetTypeID()||!CRInteger(record[@"modelPort"],modelPort,modelPort))CRFail();prepared=record;
            }else if(child==app&&[type isEqual:@"ready"]){
              if(ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"mcpOrigin",@"unlockFile",@"modelEnabled"])||![record[@"modelEnabled"] isEqual:prepared[@"modelEnabled"]])CRFail();
              origin(record[@"origin"],uiPort,NO);origin(record[@"mcpOrigin"],mcpPort,YES);unlock(record,exports);ready=YES;
              if(stopping)continue;
              // Readiness survives expiry of the initial code; the menu can request another.
              (void)CRUnlockFileAvailable(record[@"unlockFile"]);
              @try{CRDiagnostic(owner,@"ready");}@catch(NSException *e){(void)e;failed=YES;stopping=YES;}
              if(stopping)continue;
              if([owner.installation[@"mode"] isEqual:@"demo"])demoReady=[[CRDemoReady alloc] initWithOwner:owner endpoint:record[@"mcpOrigin"]];
              emit(output,generation,@"ready",@{@"origin":record[@"origin"],@"mcpOrigin":record[@"mcpOrigin"],@"unlockFile":record[@"unlockFile"],@"modelEnabled":record[@"modelEnabled"]});
            }else if(child==app&&[type isEqual:@"drained"]){
              if(drained||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();drained=YES;if(!stopping){failed=YES;stopping=YES;}
            }else if(child==app&&[type isEqual:@"unlock"]){
              if(!ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"unlockFile"]))CRFail();origin(record[@"origin"],uiPort,NO);unlock(record,exports);
              if(stopping)continue;
              if(!CRUnlockFileAvailable(record[@"unlockFile"]))continue;
              emit(output,generation,@"unlock",@{@"origin":record[@"origin"],@"unlockFile":record[@"unlockFile"]});
            }else if(child==app&&[type isEqual:@"model-status"]){
              if(!ready||!CRExact(record,@[@"version",@"generation",@"type",@"state"])||![@[@"available",@"busy",@"unavailable",@"loading"] containsObject:record[@"state"]])CRFail();if(!stopping)emit(output,generation,@"model-status",@{@"state":record[@"state"]});
            }else if(child==download&&[type isEqual:@"download-progress"]){
              if(downloadTerminal||!CRExact(record,@[@"version",@"generation",@"type",@"received",@"total"])||!CRInteger(record[@"total"],5680522464LL,5680522464LL)||!CRInteger(record[@"received"],downloadReceived,5680522464LL))CRFail();
              downloadReceived=[record[@"received"] longLongValue];emit(output,generation,type,@{@"received":record[@"received"],@"total":record[@"total"]});
            }else if(child==download&&[@[@"download-complete",@"download-cancelled",@"download-failed"] containsObject:type]){
              if(downloadTerminal||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();downloadTerminal=type;
            }else if((child==prepare||child==app)&&[type isEqual:@"failed"]){
              if(!CRExact(record,@[@"version",@"generation",@"type",@"category"])||![record[@"category"] isEqual:child==prepare?@"prepare-failed":@"application-failed"])CRFail();if(child==prepare)prepareFailed=YES;failed=YES;stopping=YES;
            }else CRFail();
            }@catch(NSException *e){(void)e;if(child==app)appRecordsFailed=YES;controlFailed=YES;failed=YES;stopping=YES;}
          }
          if(child.protocolFailed){failed=YES;stopping=YES;}
        }
      @try{
        [owner assertHeld];
        if(!stopping&&prepare.exited&&!app){
          if(!prepare.success||!prepared)CRFail();
          NSString *pair=[[root stringByAppendingPathComponent:@"stores"] stringByAppendingPathComponent:owner.installation[@"selectedStore"]];
          (void)CRPrivatePin([pair stringByAppendingPathComponent:@"data"],YES);(void)CRPrivatePin([pair stringByAppendingPathComponent:@"identity"],YES);
          if(![CRReadJSON([pair stringByAppendingPathComponent:@"identity/identity.json"],16384,YES)[@"databaseTargetId"] isEqual:prepared[@"targetId"]])CRFail();
          [owner finishOutcome:@"ok"];
          if(![owner.installation[@"setup"] isEqual:@"ready"]){NSMutableDictionary *value=[owner.installation mutableCopy];value[@"setup"]=@"ready";[owner publishInstallation:value];}
          NSDictionary *application=[owner beginRole:@"application" operation:@"serve" store:owner.installation[@"selectedStore"]];
          if([prepared[@"modelEnabled"] boolValue]){model=[[CRChild alloc] initWithExecutable:[resources stringByAppendingPathComponent:@"model/llama-server"] arguments:modelArgs(root,session,modelPort) directory:directory lock:owner.lockFD capability:nil role:@"model"];[children addObject:model];}
          app=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"application",@[[ @(uiPort) stringValue],[ @(mcpPort) stringValue]]) directory:directory lock:owner.lockFD capability:application role:@"application"];
          [children addObject:app];[app command:@"start" generation:generation];startupDeadline=CRLifecycleNow()+60;
        }
        if(!stopping&&app.exited){failed=YES;stopping=YES;}
        if(!stopping&&model.exited&&!modelObserved){modelObserved=YES;[app command:@"model-unavailable" generation:generation];emit(output,generation,@"model-status",@{@"state":@"unavailable"});}
        if(download.exited&&!downloadObserved){
          downloadObserved=YES;
          BOOL agreed=downloadTerminal&&((download.success&&![downloadTerminal isEqual:@"download-failed"])||(download.exitCode==1&&[downloadTerminal isEqual:@"download-failed"]));
          emit(output,generation,agreed?downloadTerminal:@"download-failed",nil);
          CRDiagnostic(owner,agreed?downloadTerminal:@"download-failed");
          // Exact exit is observed above; discard the completed child's control FDs.
          [children removeObject:download];download=nil;
        }
        if(download&&!download.exited&&download.statusEnded&&!downloadTerminal&&!downloadStage){
          [download command:@"quit" generation:generation];downloadStage=1;downloadDeadline=CRLifecycleNow()+15;
        }
        if(download&&!download.exited&&downloadStage&&CRLifecycleNow()>=downloadDeadline){
          if(downloadStage>=3)CRFail();[download signal:downloadStage==1?SIGTERM:SIGKILL];downloadStage++;downloadDeadline=CRLifecycleNow()+5;
        }
        for(NSDictionary *command in [shell readFrom:0]){
          if(!CRExact(command,@[@"version",@"generation",@"command"])||!CRInteger(command[@"version"],1,1)||![command[@"generation"] isEqual:generation]||![@[@"unlock",@"restart",@"quit",@"model-unavailable",@"download",@"cancel-download",@"enter-demo",@"leave-demo",@"reset-demo"] containsObject:command[@"command"]])CRFail();
          NSString *name=command[@"command"];
          if([name isEqual:@"quit"]){quitRequested=YES;stopping=YES;restart=NO;}
          else if([name isEqual:@"restart"]){if(!stopping&&!quitRequested)restart=ready;stopping=YES;}
          else if(stopping)continue;
          else if([@[@"enter-demo",@"leave-demo",@"reset-demo"] containsObject:name]){
            if(!ready||([name isEqual:@"reset-demo"]&&![owner.installation[@"mode"] isEqual:@"demo"]))CRFail();
            // Destination-port refusal leaves the current healthy runtime serving.
            @try{NSInteger target=[name isEqual:@"leave-demo"]?personalMcpPort:demoMcpPort;if(target!=mcpPort)requestedPortAvailable(target);}
            @catch(NSException *e){(void)e;emit(output,generation,@"transition-refused",nil);continue;}
            modeAction=name;stopping=YES;restart=YES;
          }
          else if(!stopping&&ready&&[name isEqual:@"download"]){
            if([owner.installation[@"mode"] isEqual:@"demo"])CRFail();
            if(download&&!download.exited)CRFail();downloadTerminal=nil;downloadObserved=NO;downloadReceived=0;downloadStage=0;
            download=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"download",@[[root stringByAppendingPathComponent:@"models"],generation]) directory:directory lock:owner.lockFD capability:nil role:@"download"];
            [children addObject:download];[download command:@"start" generation:generation];emit(output,generation,@"download-starting",nil);
          }else if(!stopping&&ready&&[name isEqual:@"cancel-download"]){
            if(!download||download.exited||downloadStage)continue;[download command:@"quit" generation:generation];downloadStage=1;downloadDeadline=CRLifecycleNow()+15;
          }
          else if(!stopping&&app&&ready)[app command:name generation:generation];else CRFail();
        }
        if(shell.ended||interrupted||output.discarded){stopping=YES;restart=NO;if(output.discarded)failed=YES;}
        if(!ready&&!stopping&&CRLifecycleNow()>=startupDeadline)CRFail();
      }@catch(NSException *exception){(void)exception;controlFailed=YES;failed=YES;stopping=YES;}
      if(!stopping&&ready){@try{[demoReady pump];}@catch(NSException *e){(void)e;failed=YES;stopping=YES;}}
      if(stopping){
        [demoReady close];
        if(!stopStage){stopStage=1;stopDeadline=CRLifecycleNow()+15;
          for(CRChild *child in children)if(!child.exited&&![child.role isEqual:@"model"])@try{[child command:@"quit" generation:generation];}@catch(NSException *e){(void)e;}
        }
        if(model&&!model.exited&&!modelStopped&&(!app||drained)){@try{[model signal:SIGTERM];}@catch(NSException *e){(void)e;failed=YES;}modelStopped=YES;}
        BOOL allExited=YES;for(CRChild *child in children)if(!child.exited)allExited=NO;
        if(allExited){
          BOOL certain=!app||(drained&&!forcedApp&&!app.protocolFailed&&!appRecordsFailed);NSString *outcome=certain?(failed?@"failed":@"ok"):@"uncertain";
          @try{[owner finishOutcome:outcome];CRDiagnostic(owner,[@"stopped-" stringByAppendingString:outcome]);emit(output,generation,@"stopped",@{@"outcome":outcome});double delivery=CRLifecycleNow()+2;while(!output.empty&&CRLifecycleNow()<delivery){[output flush];if(!output.empty)usleep(10000);}if(!output.empty)CRFail();}@catch(NSException *e){(void)e;return 1;}
          BOOL controlled=certain&&failed&&!controlFailed&&!forcedApp&&prepare&&prepare.exitCode>=0&&(prepareFailed||(prepare.success&&prepared));
          for(CRChild *child in children)if(child.protocolFailed||child.ownershipLost||child.exitCode<0)controlled=NO;
          if(controlled&&[owner.installation[@"mode"] isEqual:@"demo"]&&!quitRequested&&!shell.ended&&!interrupted&&!output.discarded){if(!unavailableDemo(owner,shell,output,personalMcpPort))return 0;again=YES;break;}
          if(!certain||failed||output.discarded)return 1;if(modeAction&&!quitRequested&&!shell.ended&&!interrupted){
            if([modeAction isEqual:@"leave-demo"])[owner selectMode:@"personal"];
            else if([modeAction isEqual:@"enter-demo"]&&owner.installation[@"demoStore"]!=[NSNull null])[owner selectMode:@"demo"];
            else if(!prepareDemo(owner,resources,shell,output))return 0;
          }
          again=restart&&!shell.ended&&!interrupted;break;
        }
        if(CRLifecycleNow()>=stopDeadline){
          if(stopStage>=3)return 1;
          for(CRChild *child in children)if(!child.exited){if(child==app)forcedApp=YES;@try{[child signal:stopStage==1?SIGTERM:SIGKILL];}@catch(NSException *e){(void)e;failed=YES;}}
          stopStage++;stopDeadline=CRLifecycleNow()+5;
        }
      }
      usleep(10000);
    }}
  }}
  return 0;
}
