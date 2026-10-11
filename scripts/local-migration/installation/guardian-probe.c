// P1 feasibility fixture, not a production supervisor or installable entrypoint.
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

static int rootfd = -1, lockfd = -1, generation = 0;
static struct stat locked;
static pid_t owners[2] = {0, 0};
static int reaped[2] = {0, 0};
static volatile sig_atomic_t interrupted = 0;

static double now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t)) _exit(9);
  return (double)t.tv_sec + (double)t.tv_nsec / 1000000000.0;
}
static void on_signal(int signal_number) { (void)signal_number; interrupted = 1; }
static int private_file(int fd) {
  struct stat s;
  return fstat(fd, &s) == 0 && S_ISREG(s.st_mode) && s.st_uid == getuid() &&
    (s.st_mode & 0777) == 0600 && s.st_nlink == 1;
}
static int same_lock(void) {
  struct stat s;
  return fstatat(rootfd, "owner.lock", &s, AT_SYMLINK_NOFOLLOW) == 0 &&
    S_ISREG(s.st_mode) && s.st_dev == locked.st_dev && s.st_ino == locked.st_ino &&
    s.st_uid == getuid() && (s.st_mode & 0777) == 0600 && s.st_nlink == 1;
}
static int journal_is_clean(void) {
  int fd = openat(rootfd, "generation", O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return errno == ENOENT;
  char data[32];
  ssize_t n = private_file(fd) ? read(fd, data, sizeof(data)) : -1;
  close(fd);
  return n == 6 && memcmp(data, "clean\n", 6) == 0;
}
static int journal(const char *value) {
  // A leftover temporary publication is uncertainty, never disposable startup state.
  int fd = openat(rootfd, "generation.tmp", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (fd < 0) return -1;
  size_t length = strlen(value);
  int good = write(fd, value, length) == (ssize_t)length && fsync(fd) == 0;
  if (close(fd)) good = 0;
  if (!good || renameat(rootfd, "generation.tmp", rootfd, "generation") || fsync(rootfd)) return -1;
  return 0;
}
static int open_root(const char *root) {
  rootfd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat s;
  if (rootfd < 0 || fstat(rootfd, &s) || !S_ISDIR(s.st_mode) ||
      s.st_uid != getuid() || (s.st_mode & 0777) != 0700) return 3;
  lockfd = openat(rootfd, "owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  if (lockfd < 0 || !private_file(lockfd) || fstat(lockfd, &locked)) return 3;
  if (flock(lockfd, LOCK_EX | LOCK_NB)) return errno == EWOULDBLOCK ? 2 : 3;
  struct stat temporary;
  if (fstatat(rootfd, "generation.tmp", &temporary, AT_SYMLINK_NOFOLLOW) == 0 ||
      errno != ENOENT || !journal_is_clean()) return 3;
  return 0;
}
static pid_t launch(const char *node, const char *fixture, const char *role) {
  pid_t child = fork();
  if (child != 0) return child;
  if (setsid() < 0) _exit(9);
  if (lockfd != 3 && dup2(lockfd, 3) < 0) _exit(9);
  if (fcntl(3, F_SETFD, 0) < 0) _exit(9);
  int nullfd = open("/dev/null", O_RDONLY);
  if (nullfd < 0 || dup2(nullfd, STDIN_FILENO) < 0) _exit(9);
  for (int fd = 4; fd < 256; fd++) close(fd);
  char number[16];
  snprintf(number, sizeof(number), "%d", generation);
  execl(node, node, "--no-global-search-paths", fixture, role, number, (char *)NULL);
  _exit(9);
}
static int start_pair(const char *node, const char *fixture) {
  if (!same_lock() || journal("uncertain\n")) return -1;
  generation++;
  for (int i = 0; i < 2; i++) { owners[i] = 0; reaped[i] = 0; }
  owners[0] = launch(node, fixture, "application");
  if (owners[0] <= 0) return -1;
  owners[1] = launch(node, fixture, "model");
  if (owners[1] <= 0) return -1;
  printf("{\"event\":\"spawned\",\"generation\":%d}\n", generation);
  return 0;
}
static int observe(void) {
  int count = 0;
  for (int i = 0; i < 2; i++) {
    if (owners[i] > 0 && !reaped[i]) {
      int status;
      pid_t value = waitpid(owners[i], &status, WNOHANG);
      if (value == owners[i]) reaped[i] = 1;
      else if (value < 0 && errno != EINTR) return -1;
    }
    if (reaped[i]) count++;
  }
  return count;
}
static void signal_owned(int signal_number) {
  for (int i = 0; i < 2; i++)
    if (owners[i] > 0 && !reaped[i]) kill(owners[i], signal_number);
}
static int stop_pair(void) {
  signal_owned(SIGTERM);
  double deadline = now() + 5;
  int count;
  while ((count = observe()) >= 0 && count != 2 && now() < deadline) usleep(10000);
  if (count != 2) {
    signal_owned(SIGKILL);
    deadline = now() + 5;
    while ((count = observe()) >= 0 && count != 2 && now() < deadline) usleep(10000);
  }
  if (count != 2) return -1;
  printf("{\"event\":\"reaped\",\"generation\":%d,\"owners\":2}\n", generation);
  if (!same_lock()) return -1;
  // Drop only our descriptor, never LOCK_UN. Survivors retain the original lock.
  close(lockfd);
  lockfd = openat(rootfd, "owner.lock", O_RDWR | O_NOFOLLOW);
  if (lockfd < 0 || !private_file(lockfd) || !same_lock()) return -1;
  deadline = now() + 5;
  while (flock(lockfd, LOCK_EX | LOCK_NB)) {
    if (errno != EWOULDBLOCK || now() >= deadline) return -1;
    usleep(10000);
  }
  if (!same_lock()) return -1;
  printf("{\"event\":\"cohort-extinct\",\"generation\":%d}\n", generation);
  return journal("clean\n");
}

int main(int argc, char **argv) {
  umask(0077);
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc < 3 || (strcmp(argv[1], "guardian") && strcmp(argv[1], "check"))) return 9;
  int admission = open_root(argv[2]);
  if (admission) return admission;
  if (!strcmp(argv[1], "check")) { puts("available-clean"); return 0; }
  if (argc != 5) return 9;
  signal(SIGTERM, on_signal);
  signal(SIGINT, on_signal);
  signal(SIGPIPE, SIG_IGN);
  int failure = start_pair(argv[3], argv[4]) != 0;
  double deadline = now() + 20;
  char command[64];
  size_t used = 0;
  while (!failure && !interrupted && now() < deadline) {
    int state = observe();
    if (state != 0) { failure = 4; break; }
    struct pollfd control = { .fd = STDIN_FILENO, .events = POLLIN | POLLHUP };
    int result = poll(&control, 1, 20);
    if (result < 0) { if (errno == EINTR) continue; failure = 3; break; }
    if (!result) continue;
    char byte;
    ssize_t n = read(STDIN_FILENO, &byte, 1);
    if (n == 0) break;
    if (n < 0 || used + 1 >= sizeof(command)) { failure = 3; break; }
    if (byte != '\n') { command[used++] = byte; continue; }
    command[used] = '\0'; used = 0;
    if (!strcmp(command, "quit")) break;
    if (!strcmp(command, "restart")) {
      if (generation >= 2 || stop_pair() || start_pair(argv[3], argv[4])) { failure = 3; break; }
    } else if (!strcmp(command, "crash-model")) {
      if (owners[1] > 0 && !reaped[1]) kill(owners[1], SIGKILL);
    } else if (!strcmp(command, "crash-application")) {
      if (owners[0] > 0 && !reaped[0] && kill(owners[0], SIGKILL) == 0)
        puts("{\"event\":\"injected-owned-loss\",\"role\":\"application\"}");
    } else { failure = 3; break; }
  }
  if (stop_pair()) return 3;
  puts("{\"event\":\"clean\"}");
  return failure;
}
