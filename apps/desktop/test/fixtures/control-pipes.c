// Test-only anonymous-FIFO owner. Retains its writer while observing exact child exit.
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec+t.tv_nsec/1e9; }
int main(int argc,char **argv) {
  if(argc!=4)return 90; int input[2],output[2]; if(pipe(input)||pipe(output))return 90;
  int source=fcntl(input[0],F_DUPFD_CLOEXEC,10),sink=fcntl(output[1],F_DUPFD_CLOEXEC,10);
  if(source<0||sink<0)return 90; int maximum=getdtablesize();pid_t pid=fork();if(pid<0)return 90;
  if(!pid){if(dup2(source,5)<0||dup2(sink,6)<0)_exit(90);close(3);close(4);for(int fd=7;fd<maximum;fd++)close(fd);
    char *args[]={argv[1],argv[2],argv[3],NULL};char *env[]={NULL};execve(args[0],args,env);_exit(90);}
  close(source);close(sink);close(input[0]);close(output[1]);signal(SIGPIPE,SIG_IGN);
  const char *start="{\"version\":1,\"generation\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"command\":\"start\"}\n";
  const char *quit="{\"version\":1,\"generation\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"command\":\"quit\"}\n";
  if(!strcmp(argv[3],"malformed")){if(write(input[1],"{}\n",3)!=3)return 90;}
  else if(strcmp(argv[3],"timeout")){if(write(input[1],start,strlen(start))!=(ssize_t)strlen(start))return 90;
    if(!strcmp(argv[3],"start-quit")&&write(input[1],quit,strlen(quit))!=(ssize_t)strlen(quit))return 90;}
  double deadline=now()+8;int status=0;while(now()<deadline){if(waitpid(pid,&status,WNOHANG)==pid){close(input[1]);close(output[0]);return WIFEXITED(status)?WEXITSTATUS(status):92;}usleep(10000);}
  kill(pid,SIGKILL);if(waitpid(pid,&status,0)!=pid)return 93;close(input[1]);close(output[0]);return 91;
}
