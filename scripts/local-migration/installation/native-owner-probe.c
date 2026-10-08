// P1 experiment owner only. Not a production supervisor or journal mechanism.
#define _DARWIN_C_SOURCE
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;
static void stop(int ignored) { (void)ignored; stopping = 1; }
static double now(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value)) _exit(9);
  return value.tv_sec + value.tv_nsec / 1e9;
}
static int private_regular(int fd) {
  struct stat s;
  return !fstat(fd, &s) && S_ISREG(s.st_mode) && s.st_uid == getuid() &&
    (s.st_mode & 07777) == 0600 && s.st_nlink == 1;
}
int main(int argc, char **argv) {
  umask(0077); setvbuf(stdout, NULL, _IONBF, 0);
  if (argc < 3 || (strcmp(argv[1], "own") && strcmp(argv[1], "check"))) return 9;
  int root = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat s;
  if (root < 0 || fstat(root, &s) || s.st_uid != getuid() || (s.st_mode & 07777) != 0700) return 9;
  int lock = openat(root, "owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  if (lock < 0 || !private_regular(lock)) return 9;
  if (flock(lock, LOCK_EX | LOCK_NB)) return errno == EWOULDBLOCK ? 2 : 9;
  if (!strcmp(argv[1], "check")) return 0;
  // The 150-second mode is never invoked without separately recorded user approval.
  if (argc < 5 || (strcmp(argv[3], "20") && strcmp(argv[3], "150")) || argv[4][0] != '/') return 9;
  int log = openat(root, "native.log", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (log < 0 || !private_regular(log)) return 9;
  int output[2];
  if (pipe(output)) return 9;
  signal(SIGTERM, stop); signal(SIGINT, stop); signal(SIGPIPE, SIG_IGN);
  pid_t child = fork();
  if (child < 0) return 9;
  if (child == 0) {
    if (setsid() < 0) _exit(9);
    int devnull = open("/dev/null", O_RDONLY);
    if (devnull < 0 || dup2(devnull, 0) < 0 || dup2(output[1], 1) < 0 || dup2(output[1], 2) < 0 ||
        dup2(lock, 3) < 0 || fcntl(3, F_SETFD, 0) < 0) _exit(9);
    for (int fd = 4; fd < 256; fd++) close(fd);
    execv(argv[4], &argv[4]); _exit(9);
  }
  close(output[1]);
  if (fcntl(output[0], F_SETFL, O_NONBLOCK)) stopping = 1;
  printf("{\"event\":\"owned-start\",\"pid\":%d}\n", child);
  double deadline = now() + atoi(argv[3]);
  size_t total = 0, used = 0;
  char command[32], bytes[4096];
  int exited = 0, status = 0, failure = 0;
  while (!stopping && now() < deadline) {
    pid_t observed = waitpid(child, &status, WNOHANG);
    if (observed == child) { exited = 1; failure = 4; break; }
    if (observed < 0 && errno != EINTR) { failure = 9; break; }
    struct pollfd fds[2] = {{.fd = 0, .events = POLLIN | POLLHUP}, {.fd = output[0], .events = POLLIN | POLLHUP}};
    if (poll(fds, 2, 20) < 0) { if (errno == EINTR) continue; failure = 9; break; }
    if (fds[1].revents) {
      ssize_t count;
      while ((count = read(output[0], bytes, sizeof(bytes))) > 0) {
        total += count;
        if (total > 1024 * 1024 || write(log, bytes, count) != count) { failure = 9; stopping = 1; break; }
      }
    }
    if (fds[0].revents) {
      char c;
      ssize_t count = read(0, &c, 1);
      if (count == 0) break;
      if (count < 0 || used + 1 >= sizeof(command)) { failure = 9; break; }
      if (c != '\n') { command[used++] = c; continue; }
      command[used] = '\0'; used = 0;
      if (!strcmp(command, "quit")) break;
      if (!strcmp(command, "release-lock") && lock >= 0) {
        close(lock); lock = -1; // Never LOCK_UN; exact child remains owned/reapable.
        puts("{\"event\":\"lock-released\"}");
      } else { failure = 9; break; }
    }
  }
  if (!exited) {
    kill(child, SIGTERM);
    deadline = now() + 5;
    while (now() < deadline) {
      if (waitpid(child, &status, WNOHANG) == child) { exited = 1; break; }
      usleep(10000);
    }
  }
  if (!exited) {
    kill(child, SIGKILL);
    deadline = now() + 5;
    while (now() < deadline) {
      if (waitpid(child, &status, WNOHANG) == child) { exited = 1; break; }
      usleep(10000);
    }
  }
  ssize_t count;
  while ((count = read(output[0], bytes, sizeof(bytes))) > 0) {
    total += count;
    if (total > 1024 * 1024 || write(log, bytes, count) != count) { failure = 9; break; }
  }
  if (!exited || fsync(log)) return 9;
  puts("{\"event\":\"reaped\"}");
  return failure;
}
