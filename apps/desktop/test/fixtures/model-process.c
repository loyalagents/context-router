#include <sys/stat.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
static int evidence=-1;
static char drained[4096];
static void stop(int number){
  (void)number;const char *message=access(drained,F_OK)?"term-before-drain\n":"term-after-drain\n";
  (void)write(evidence,message,strlen(message));
#if MODEL_VARIANT != 2
  _exit(0);
#endif
}
int main(int argc,char **argv){
  struct stat info;int inherited=fstat(3,&info)==0&&S_ISREG(info.st_mode);
  for(int fd=4;fd<=6;fd++){errno=0;if(fstat(fd,&info)==0||errno!=EBADF)inherited=0;}
  const char *model=NULL;for(int i=1;i+1<argc;i++)if(!strcmp(argv[i],"--model"))model=argv[i+1];if(!model)return 2;
  char file[4096];if(snprintf(file,sizeof(file),"%s.fixture-events",model)>=(int)sizeof(file)||snprintf(drained,sizeof(drained),"%s.app-drained",model)>=(int)sizeof(drained))return 3;
  evidence=open(file,O_WRONLY|O_CREAT|O_EXCL,0600);if(evidence<0)return 4;
  if(write(evidence,inherited?"fd3-only\n":"bad-fds\n",inherited?9:8)<0)return 5;
  if(!inherited)return 6;
#if MODEL_VARIANT == 1
  return 7;
#else
  signal(SIGTERM,stop);while(1)pause();
#endif
}
