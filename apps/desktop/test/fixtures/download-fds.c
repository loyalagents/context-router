#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>
#include <stdio.h>
int main(void){
  struct stat lock,input,output;errno=0;int missing=fcntl(4,F_GETFD)<0&&errno==EBADF;
  int okay=missing&&!fstat(3,&lock)&&S_ISREG(lock.st_mode)&&!fstat(5,&input)&&S_ISFIFO(input.st_mode)&&!fstat(6,&output)&&S_ISFIFO(output.st_mode);
  char c;while(read(5,&c,1)==1&&c!='\n'){}
  const char *message=okay?"{\"lifetime\":true,\"storageAbsent\":true,\"control\":true}\n":"{\"invalid\":true}\n";
  if(dprintf(6,"%s",message)<0)return 1;return okay?0:2;
}
