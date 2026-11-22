// Owned offline CLI fixture: no provider, Keychain, user configuration or model.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
int main(int argc,char **argv){
 if(argc==2&&!strcmp(argv[1],"--version")){puts("2.1.299");return 0;}
 if(argc==2&&!strcmp(argv[1],"--help")){puts("--restricted --strict-mcp-config --tools --setting-sources --disable-slash-commands --no-chrome");return 0;}
 if(argc==3&&(!strcmp(argv[1],"--bg")||!strcmp(argv[1],"--background"))){fprintf(stderr,"'%s' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\n",argv[1]);return 1;}
 char marker[PATH_MAX];snprintf(marker,sizeof(marker),"%s/fixture-login",getenv("CLAUDE_CONFIG_DIR"));
 if(argc>=4&&!strcmp(argv[argc-3],"auth")&&!strcmp(argv[argc-2],"status")){
  int logged=access(marker,F_OK)==0;
  printf("{\"loggedIn\":%s,\"apiProvider\":\"firstParty\",\"authMethod\":\"%s\",\"analyticsDisabled\":true,\"configDirectory\":\"%s\"}\n",logged?"true":"false",logged?"oauth":"none",getenv("CLAUDE_CONFIG_DIR"));return logged?0:1;
 }
 if(argc>=3&&!strcmp(argv[argc-2],"auth")&&!strcmp(argv[argc-1],"login")){
  if(getenv("CR_DEMO_TOKEN"))return 9;FILE *file=fopen(marker,"wx");if(!file)return 8;fputs("signed in once",file);fclose(file);return 0;
 }
 if(!getenv("CR_DEMO_TOKEN")||getenv("ANTHROPIC_API_KEY")||getenv("NODE_OPTIONS"))return 7;
 int coding=0;for(int i=1;i+1<argc;i++)if(!strcmp(argv[i],"--tools")&&!strcmp(argv[i+1],"default"))coding=1;
 if(!coding)return 6;
 // Run an ordinary project tool through the clean coding PATH.
 int result=system("node -e 'require(\"fs\").writeFileSync(\"coding-result.txt\",\"demo coding works\")'")?5:0;
 if(result)return result;
 char ready[80];snprintf(ready,sizeof(ready),"chat-%d.ready",getpid());FILE *file=fopen(ready,"wx");if(!file)return 10;fclose(file);
 char release[80];snprintf(release,sizeof(release),"chat-%d.release",getpid());
 for(int i=0;access("hold-chats",F_OK)==0&&access(release,F_OK)!=0;i++){if(i>600)return 11;usleep(100000);}
 return 0;
}
