#include <stdio.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
static void finish(int signal){(void)signal;_exit(0);}
int main(int argc,char **argv){
 if(argc<2)return 2;
 if(!strcmp(argv[1],"normal")){for(int fd=3;fd<64;fd++)if(fcntl(fd,F_GETFD)>=0)return 3;if(getenv("CR_DEMO_TOKEN")||getenv("LOCAL_DATABASE_ROOT"))return 4;puts("{\"ok\":true}");return 0;}
 if(!strcmp(argv[1],"overflow")){for(int i=0;i<70000;i++)putchar('x');return 0;}
 if(!strcmp(argv[1],"silent")||!strcmp(argv[1],"pipe")){
  pid_t child=fork();if(child<0)return 5;if(child){printf("{\"descendant\":%d}\n",child);return 0;}
  if(!strcmp(argv[1],"silent")){close(1);close(2);}signal(SIGTERM,SIG_IGN);for(;;)pause();
 }
 if(!strcmp(argv[1],"graceful"))signal(SIGTERM,finish);else signal(SIGTERM,SIG_IGN);
 puts("{\"started\":true}");fflush(stdout);for(;;)pause();
}
