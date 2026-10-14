#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv){
 if(argc!=3)return 2;
 FILE *marker=fopen(argv[2],"w");if(!marker)return 2;fprintf(marker,"%d\n",getpid());fclose(marker);
 if(!strcmp(argv[1],"signal")){raise(SIGTERM);return 2;}
 if(!strcmp(argv[1],"linger")){usleep(600000);return 0;}
 pid_t child=fork();if(child<0)return 2;if(!child){usleep(100000);_exit(0);}
 int status=0;if(waitpid(child,&status,0)!=child||!WIFEXITED(status))return 2;
 return !strcmp(argv[1],"error")?7:0;
}
