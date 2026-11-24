// Owned offline Codex fixture: no provider, user configuration or model.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>
static int has(int argc,char **argv,const char *value){for(int i=1;i<argc;i++)if(!strcmp(argv[i],value))return 1;return 0;}
int main(int argc,char **argv){
 if(argc==2&&!strcmp(argv[1],"--version")){puts("codex-cli 0.160.0");return 0;}
 if(argc==2&&!strcmp(argv[1],"--help")){puts("--no-daemon --strict-config --sandbox");return 0;}
 if(has(argc,argv,"features")){
  for(int i=1;i<argc;i++)if(!strncmp(argv[i],"features.",9)){char entry[200];snprintf(entry,sizeof(entry),"%s",argv[i]+9);char *equals=strchr(entry,'=');if(!equals)return 12;*equals=0;printf("%s stable %s\n",entry,!strcmp(entry,"unified_exec")?"true":equals+1);}return 0;
 }
 if(has(argc,argv,"mcp")){puts("[{\"name\":\"context_router_demo\",\"transport\":{\"bearer_token_env_var\":\"CR_DEMO_TOKEN\"}}]");return 0;}
 if(!getenv("CODEX_HOME")||getenv("OPENAI_API_KEY")||getenv("NODE_OPTIONS"))return 7;
 char marker[PATH_MAX];snprintf(marker,sizeof(marker),"%s/fixture-login",getenv("CODEX_HOME"));
 if(has(argc,argv,"login")){
  char cwd[PATH_MAX];if(!getcwd(cwd,sizeof(cwd))||strcmp(cwd,getenv("HOME")))return 13;
  if(getenv("CR_DEMO_TOKEN")||!has(argc,argv,"cli_auth_credentials_store=\"file\""))return 9;
  if(has(argc,argv,"status")){int logged=access(marker,F_OK)==0;fprintf(stderr,"%s\n",logged?"Logged in using ChatGPT":"Not logged in");return logged?0:1;}
  FILE *file=fopen(marker,"wx");if(!file)return 8;fputs("signed in once",file);fclose(file);return 0;
 }
 if(!getenv("CR_DEMO_TOKEN")){fprintf(stderr,"Error: stdin is not a terminal\n");return 1;}
 if(!has(argc,argv,"features.shell_tool=true")||!has(argc,argv,"workspace-write")||!has(argc,argv,"on-request")||!has(argc,argv,"mcp_servers.context_router_demo.tools.mutatePreferences.approval_mode=\"prompt\""))return 6;
 const char *temporary=getenv("TMPDIR");struct stat st;
 if(!temporary||strlen(temporary)>64||stat(temporary,&st)||st.st_uid!=getuid()||(st.st_mode&0777)!=0700)return 12;
 char temporaryRecord[80];snprintf(temporaryRecord,sizeof(temporaryRecord),"chat-%d.tmp",getpid());FILE *record=fopen(temporaryRecord,"wx");if(!record)return 13;fputs(temporary,record);fclose(record);
 if(system("node -e 'require(\"fs\").writeFileSync(\"coding-result.txt\",\"demo coding works\")'"))return 5;
 char ready[80],release[80];snprintf(ready,sizeof(ready),"chat-%d.ready",getpid());FILE *file=fopen(ready,"wx");if(!file)return 10;fclose(file);
 snprintf(release,sizeof(release),"chat-%d.release",getpid());for(int i=0;access("hold-chats",F_OK)==0&&access(release,F_OK)!=0;i++){if(i>600)return 11;usleep(100000);}return 0;
}
