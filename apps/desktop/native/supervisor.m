#import "supervisor.h"
#import "process.h"
#import "diagnostics.h"
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
  (void)CRPrivatePin(file,NO);
}
static void origin(id value,NSInteger requested,BOOL mcp){
  NSString *expression=mcp?@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}/mcp":@"http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}";
  if(!CRPattern(value,expression))CRFail();NSURL *url=[NSURL URLWithString:value];NSInteger port=url.port.integerValue;
  if(port<1||port>65535||(requested&&port!=requested))CRFail();
}
int CRRunGuardian(NSString *bundle,NSString *root,NSInteger uiPort,NSInteger mcpPort){
  umask(0077);signal(SIGPIPE,SIG_IGN);signal(SIGTERM,stopSignal);signal(SIGINT,stopSignal);signal(SIGCHLD,SIG_DFL);
  if(fcntl(0,F_SETFL,fcntl(0,F_GETFL)|O_NONBLOCK)||fcntl(1,F_SETFL,fcntl(1,F_GETFL)|O_NONBLOCK))CRFail();
  CRWriteQueue *output=[[CRWriteQueue alloc] initWithFD:1];
  CRFrames *shell=[CRFrames new];NSString *resources=[bundle stringByAppendingPathComponent:@"Contents/Resources"],*node=[resources stringByAppendingPathComponent:@"bin/node"],*directory=[resources stringByAppendingPathComponent:@"app"];
  BOOL again=YES;
  while(again){@autoreleasepool{
    again=NO;
    requestedPortAvailable(uiPort);requestedPortAvailable(mcpPort);
    CREnvelope *owner=[[CREnvelope alloc] initWithRoot:root allowFresh:YES];
    if(!owner.fresh&&![owner.installation[@"setup"] isEqual:@"ready"])CRFail();
    NSDictionary *cap=[owner beginRole:@"prepare" operation:owner.fresh?@"initialize":@"verify" store:owner.installation[@"selectedStore"]];
    NSString *generation=owner.generation,*session=[[root stringByAppendingPathComponent:@"sessions"] stringByAppendingPathComponent:generation],*exports=[[root stringByAppendingPathComponent:@"exports"] stringByAppendingPathComponent:generation];
    NSMutableArray<CRChild *> *children=[NSMutableArray array];CRChild *prepare=nil,*app=nil,*model=nil,*download=nil;
    NSString *downloadTerminal=nil;BOOL downloadObserved=NO;long long downloadReceived=0;NSInteger downloadStage=0;double downloadDeadline=0;
    NSDictionary *prepared=nil;BOOL ready=NO,drained=NO,failed=NO,stopping=NO,restart=NO,quitRequested=NO,forcedApp=NO,appRecordsFailed=NO,modelStopped=NO,modelObserved=NO;
    NSInteger stopStage=0,modelPort=vacantPort();double startupDeadline=CRNow()+120,stopDeadline=0;
    @try{
      CRDiagnostic(owner,@"starting");
      CRPrivateDirectory(session,YES);CRPrivateDirectory(exports,YES);
      prepare=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"prepare",@[[ @(modelPort) stringValue]]) directory:directory lock:owner.lockFD capability:cap role:@"prepare"];
      [children addObject:prepare];[prepare command:@"start" generation:generation];emit(output,generation,@"starting",@{@"phase":@"preparing"});
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
              @try{CRDiagnostic(owner,@"ready");}@catch(NSException *e){(void)e;failed=YES;stopping=YES;}
              if(stopping)continue;
              emit(output,generation,@"ready",@{@"origin":record[@"origin"],@"mcpOrigin":record[@"mcpOrigin"],@"unlockFile":record[@"unlockFile"],@"modelEnabled":record[@"modelEnabled"]});
            }else if(child==app&&[type isEqual:@"drained"]){
              if(drained||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();drained=YES;if(!stopping){failed=YES;stopping=YES;}
            }else if(child==app&&[type isEqual:@"unlock"]){
              if(!ready||!CRExact(record,@[@"version",@"generation",@"type",@"origin",@"unlockFile"]))CRFail();origin(record[@"origin"],uiPort,NO);unlock(record,exports);
              if(stopping)continue;
              emit(output,generation,@"unlock",@{@"origin":record[@"origin"],@"unlockFile":record[@"unlockFile"]});
            }else if(child==app&&[type isEqual:@"model-status"]){
              if(!ready||!CRExact(record,@[@"version",@"generation",@"type",@"state"])||![@[@"available",@"busy",@"unavailable",@"loading"] containsObject:record[@"state"]])CRFail();if(!stopping)emit(output,generation,@"model-status",@{@"state":record[@"state"]});
            }else if(child==download&&[type isEqual:@"download-progress"]){
              if(downloadTerminal||!CRExact(record,@[@"version",@"generation",@"type",@"received",@"total"])||!CRInteger(record[@"total"],5680522464LL,5680522464LL)||!CRInteger(record[@"received"],downloadReceived,5680522464LL))CRFail();
              downloadReceived=[record[@"received"] longLongValue];emit(output,generation,type,@{@"received":record[@"received"],@"total":record[@"total"]});
            }else if(child==download&&[@[@"download-complete",@"download-cancelled",@"download-failed"] containsObject:type]){
              if(downloadTerminal||!CRExact(record,@[@"version",@"generation",@"type"]))CRFail();downloadTerminal=type;
            }else if((child==prepare||child==app)&&[type isEqual:@"failed"]){
              if(!CRExact(record,@[@"version",@"generation",@"type",@"category"])||![@[@"prepare-failed",@"application-failed"] containsObject:record[@"category"]])CRFail();failed=YES;stopping=YES;
            }else CRFail();
            }@catch(NSException *e){(void)e;if(child==app)appRecordsFailed=YES;failed=YES;stopping=YES;}
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
          if(![owner.installation[@"setup"] isEqual:@"ready"]){NSMutableDictionary *value=[owner.installation mutableCopy];value[@"setup"]=@"ready";[owner publishInstallation:value];}
          NSDictionary *application=[owner beginRole:@"application" operation:@"serve" store:owner.installation[@"selectedStore"]];
          if([prepared[@"modelEnabled"] boolValue]){model=[[CRChild alloc] initWithExecutable:[resources stringByAppendingPathComponent:@"model/llama-server"] arguments:modelArgs(root,session,modelPort) directory:directory lock:owner.lockFD capability:nil role:@"model"];[children addObject:model];}
          app=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"application",@[[ @(uiPort) stringValue],[ @(mcpPort) stringValue]]) directory:directory lock:owner.lockFD capability:application role:@"application"];
          [children addObject:app];[app command:@"start" generation:generation];startupDeadline=CRNow()+60;
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
          [download command:@"quit" generation:generation];downloadStage=1;downloadDeadline=CRNow()+15;
        }
        if(download&&!download.exited&&downloadStage&&CRNow()>=downloadDeadline){
          if(downloadStage>=3)CRFail();[download signal:downloadStage==1?SIGTERM:SIGKILL];downloadStage++;downloadDeadline=CRNow()+5;
        }
        for(NSDictionary *command in [shell readFrom:0]){
          if(!CRExact(command,@[@"version",@"generation",@"command"])||!CRInteger(command[@"version"],1,1)||![command[@"generation"] isEqual:generation]||![@[@"unlock",@"restart",@"quit",@"model-unavailable",@"download",@"cancel-download"] containsObject:command[@"command"]])CRFail();
          NSString *name=command[@"command"];
          if([name isEqual:@"quit"]){quitRequested=YES;stopping=YES;restart=NO;}
          else if([name isEqual:@"restart"]){if(!stopping&&!quitRequested)restart=ready;stopping=YES;}
          else if(stopping)continue;
          else if(!stopping&&ready&&[name isEqual:@"download"]){
            if(download&&!download.exited)CRFail();downloadTerminal=nil;downloadObserved=NO;downloadReceived=0;downloadStage=0;
            download=[[CRChild alloc] initWithExecutable:node arguments:nodeArgs(resources,@"download",@[[root stringByAppendingPathComponent:@"models"],generation]) directory:directory lock:owner.lockFD capability:nil role:@"download"];
            [children addObject:download];[download command:@"start" generation:generation];emit(output,generation,@"download-starting",nil);
          }else if(!stopping&&ready&&[name isEqual:@"cancel-download"]){
            if(!download||download.exited||downloadStage)continue;[download command:@"quit" generation:generation];downloadStage=1;downloadDeadline=CRNow()+15;
          }
          else if(!stopping&&app&&ready)[app command:name generation:generation];else CRFail();
        }
        if(shell.ended||interrupted||output.discarded){stopping=YES;restart=NO;if(output.discarded)failed=YES;}
        if(!ready&&!stopping&&CRNow()>=startupDeadline)CRFail();
      }@catch(NSException *exception){(void)exception;failed=YES;stopping=YES;}
      if(stopping){
        if(!stopStage){stopStage=1;stopDeadline=CRNow()+15;
          for(CRChild *child in children)if(!child.exited&&![child.role isEqual:@"model"])@try{[child command:@"quit" generation:generation];}@catch(NSException *e){(void)e;}
        }
        if(model&&!model.exited&&!modelStopped&&(!app||drained)){@try{[model signal:SIGTERM];}@catch(NSException *e){(void)e;failed=YES;}modelStopped=YES;}
        BOOL allExited=YES;for(CRChild *child in children)if(!child.exited)allExited=NO;
        if(allExited){
          BOOL certain=!app||(drained&&!forcedApp&&!app.protocolFailed&&!appRecordsFailed);NSString *outcome=certain?(failed?@"failed":@"ok"):@"uncertain";
          @try{[owner finishOutcome:outcome];CRDiagnostic(owner,[@"stopped-" stringByAppendingString:outcome]);emit(output,generation,@"stopped",@{@"outcome":outcome});double delivery=CRNow()+2;while(!output.empty&&CRNow()<delivery){[output flush];if(!output.empty)usleep(10000);}if(!output.empty)CRFail();}@catch(NSException *e){(void)e;return 1;}
          if(!certain||failed||output.discarded)return 1;again=restart&&!shell.ended&&!interrupted;break;
        }
        if(CRNow()>=stopDeadline){
          if(stopStage>=3)return 1;
          for(CRChild *child in children)if(!child.exited){if(child==app)forcedApp=YES;@try{[child signal:stopStage==1?SIGTERM:SIGKILL];}@catch(NSException *e){(void)e;failed=YES;}}
          stopStage++;stopDeadline=CRNow()+5;
        }
      }
      usleep(10000);
    }}
  }}
  return 0;
}
