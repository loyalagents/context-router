#include <stdio.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
static void finish(int signal){(void)signal;_exit(0);}
int main(int argc,char **argv){
 if(argc<2)return 2;
 if(!strcmp(argv[1],"coexist")){if(argc!=3)return 10;for(int i=0;i<5000;i++){if(!access(argv[2],F_OK))return 0;usleep(1000);}return 11;}
 if(!strcmp(argv[1],"normal")){for(int fd=3;fd<64;fd++)if(fcntl(fd,F_GETFD)>=0)return 3;if(getenv("CR_DEMO_TOKEN")||getenv("LOCAL_DATABASE_ROOT"))return 4;puts("{\"ok\":true}");return 0;}
 if(!strcmp(argv[1],"changed-group")){if(setpgid(0,getpgid(getppid())))return 9;for(;;)pause();}
 if(!strcmp(argv[1],"exit-race")||!strcmp(argv[1],"exit-race-tree")){
  signal(SIGUSR1,finish);char marker[4096];snprintf(marker,sizeof(marker),"%s.race-ready",argv[0]);
  if(!strcmp(argv[1],"exit-race-tree")){signal(SIGTERM,SIG_IGN);pid_t child=fork();if(child<0)return 8;if(!child){signal(SIGUSR1,SIG_IGN);for(;;)pause();}printf("{\"descendant\":%d}\n",child);fflush(stdout);}
  int ready=open(marker,O_WRONLY|O_CREAT|O_EXCL,0600);if(ready<0)return 7;close(ready);for(;;)pause();
 }
 if(!strcmp(argv[1],"overflow")){for(int i=0;i<70000;i++)putchar('x');return 0;}
 if(!strcmp(argv[1],"silent")||!strcmp(argv[1],"pipe")){
  pid_t child=fork();if(child<0)return 5;if(child){printf("{\"descendant\":%d}\n",child);return 0;}
  if(!strcmp(argv[1],"silent")){close(1);close(2);}signal(SIGTERM,SIG_IGN);for(;;)pause();
 }
 if(!strcmp(argv[1],"graceful"))signal(SIGTERM,finish);else signal(SIGTERM,SIG_IGN);
 puts("{\"started\":true}");fflush(stdout);for(;;)pause();
}
