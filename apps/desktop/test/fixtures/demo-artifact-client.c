// Owned offline stand-in. It never contacts a provider, reads Keychain or prints credentials.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
int main(int argc,char **argv){
 if(argc==2&&!strcmp(argv[1],"--version")){puts("2.1.299");return 0;}
 if(argc==2&&!strcmp(argv[1],"--help")){puts("--restricted --strict-mcp-config --tools --setting-sources --disable-slash-commands --no-chrome");return 0;}
 if(argc==3&&(!strcmp(argv[1],"--bg")||!strcmp(argv[1],"--background"))){fprintf(stderr,"'%s' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\n",argv[1]);return 1;}
 if(argc>=4&&!strcmp(argv[argc-3],"auth")&&!strcmp(argv[argc-2],"status")){
  printf("{\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\",\"analyticsDisabled\":true,\"configDirectory\":\"%s\"}\n",getenv("CLAUDE_CONFIG_DIR"));return 1;
 }
 for(int fd=3;fd<128;fd++)if(fcntl(fd,F_GETFD)>=0)return 4;
 if(getenv("ANTHROPIC_API_KEY")||getenv("LOCAL_DATABASE_ROOT")||getenv("NODE_OPTIONS"))return 5;
 if(!getenv("CLAUDE_CONFIG_DIR")||!getenv("TERM")||strcmp(getenv("TERM"),"xterm-256color"))return 6;
 puts("{\"syntheticClient\":true,\"closedDescriptors\":true,\"cleanEnvironment\":true,\"terminalType\":true}");return 0;
}
