/* Test-only finite owner; arbitrary fixture executables never enter the product guardian. */
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
int main(int argc, char **argv) {
  if (argc != 8) return 9;
  signal(SIGPIPE, SIG_IGN);
  char lockfile[4096];
  if (snprintf(lockfile, sizeof(lockfile), "%s/owner.lock", argv[1]) >= (int)sizeof(lockfile)) return 9;
  int lock = open(lockfile, O_RDWR | O_NOFOLLOW);
  if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB)) return 9;
  if (!strcmp(argv[2], "wrong-mode") && fchmod(lock, 0644)) return 9;
  int msg = open(argv[6], O_RDONLY | O_NOFOLLOW), channel[2];
  if (msg < 0 || pipe(channel)) return 9;
  pid_t child = fork();
  if (child < 0) return 9;
  if (child == 0) {
    int fd3 = lock;
    if (!strcmp(argv[2], "reopened")) fd3 = open(lockfile, O_RDWR | O_NOFOLLOW);
    /* High duplicates prevent mapping low descriptors from clobbering another input. */
    int a = fcntl(fd3, F_DUPFD, 20), b = fcntl(!strcmp(argv[2], "regular-pipe") ? msg : channel[0], F_DUPFD, 20);
    if (a < 0 || b < 0 || dup2(a, 3) < 0 || dup2(b, 4) < 0) _exit(9);
    for (int fd = 5; fd < 256; fd++) close(fd);
    char *args[] = {argv[3], argv[4], argv[5], argv[1], argv[7], NULL};
    execv(args[0], args); _exit(9);
  }
  close(channel[0]);
  if (strcmp(argv[2], "stall")) {
    char bytes[1024]; ssize_t n;
    while ((n = read(msg, bytes, sizeof(bytes))) > 0) {
      ssize_t offset = 0;
      while (offset < n) { ssize_t k = write(channel[1], bytes + offset, n - offset); if (k <= 0) goto sent; offset += k; }
    }
  sent: close(channel[1]); channel[1] = -1;
  }
  close(msg);
  double end = now() + 12;
  int status;
  while (now() < end) {
    if (waitpid(child, &status, WNOHANG) == child) { fputs("fixture-owned-child-reaped\n", stderr); return WIFEXITED(status) ? WEXITSTATUS(status) : 9; }
    usleep(10000);
  }
  kill(child, SIGKILL);
  end = now() + 5;
  while (now() < end) { if (waitpid(child, &status, WNOHANG) == child) { fputs("fixture-owned-child-reaped\n", stderr); return 9; } usleep(10000); }
  return 9;
}
