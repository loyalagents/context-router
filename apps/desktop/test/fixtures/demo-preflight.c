#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include <limits.h>
int main(int argc,char **argv){
 char directory[PATH_MAX],file[PATH_MAX];snprintf(directory,sizeof(directory),"%s",argv[0]);char *slash=strrchr(directory,'/');if(!slash)return 2;*slash=0;
 if(argc==2&&!strcmp(argv[1],"--version")){
  snprintf(file,sizeof(file),"%s/preflight",directory);FILE *marker=fopen(file,"w");if(!marker)return 2;fclose(marker);
  snprintf(file,sizeof(file),"%s/continue",directory);for(int i=0;i<500&&access(file,F_OK);i++)usleep(10000);
  if(access(file,F_OK))return 2;puts("2.1.299");return 0;
 }
 if(argc==2&&!strcmp(argv[1],"--help")){puts("--bare --strict-mcp-config --tools --setting-sources --disable-slash-commands --no-chrome");return 0;}
 if(argc==3&&(!strcmp(argv[1],"--bg")||!strcmp(argv[1],"--background"))){fprintf(stderr,"'%s' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\n",argv[1]);return 1;}
 snprintf(file,sizeof(file),"%s/launched",directory);FILE *marker=fopen(file,"w");if(marker)fclose(marker);return 0;
}
