#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/net.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/signalfd.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

_Static_assert(sizeof(unsigned long) == 8, "socketcall argument blocks are read as 64-bit words");

struct policy { long socketcall, call_socket, call_pair; int unix_domain, pair_type, type_mask; };
static struct policy P = { -1, -1, -1, -1, -1, -1 };

static int parse_policy(char *s) {
  for (char *tok = strtok(s, ","); tok; tok = strtok(NULL, ",")) {
    char *eq = strchr(tok, '='); if (!eq) return -1; *eq = 0; long v = strtol(eq + 1, NULL, 10);
    if (!strcmp(tok, "socketcall")) P.socketcall = v; else if (!strcmp(tok, "socket")) P.call_socket = v;
    else if (!strcmp(tok, "socketpair")) P.call_pair = v; else if (!strcmp(tok, "unix")) P.unix_domain = v;
    else if (!strcmp(tok, "stream")) P.pair_type = v; else if (!strcmp(tok, "typemask")) P.type_mask = (int)v; else return -1;
  }
  return P.socketcall < 0 || P.call_socket < 0 || P.call_pair < 0 || P.unix_domain < 0 || P.pair_type < 0 || P.type_mask < 0 ? -1 : 0;
}
static void die(const char *m) { fprintf(stderr, "pstack-netbroker: %s: %s\n", m, strerror(errno)); _exit(125); }
static void fail(const char *m) { fprintf(stderr, "pstack-netbroker: %s\n", m); _exit(125); }

static long sc(long call, unsigned long a, unsigned long b, unsigned long c, unsigned long d) {
  unsigned long args[4] = { a, b, c, d }; long r = syscall(P.socketcall, call, args); return r < 0 ? -errno : r;
}
static int selftest(void) {
  int sv[2] = { -1, -1 }; int bad = 0;
#define EXPECT(name, got, want) do { long g = (got); printf("%s: %s\n", name, g >= 0 ? "ok" : strerror(-g)); if ((want) == 0 ? g < 0 : g != -(want)) bad = 1; } while (0)
  EXPECT("socketcall socket(AF_INET,STREAM)", sc(P.call_socket, AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0, 0), 0);
  EXPECT("socketcall socket(AF_UNIX,STREAM)", sc(P.call_socket, P.unix_domain, SOCK_STREAM, 0, 0), EPERM);
  EXPECT("socketcall socketpair(AF_UNIX,DGRAM)", sc(P.call_pair, P.unix_domain, SOCK_DGRAM, 0, (unsigned long)sv), EPERM);
  EXPECT("socketcall socketpair(AF_UNIX,STREAM)", sc(P.call_pair, P.unix_domain, SOCK_STREAM, 0, (unsigned long)sv), 0);
  if (sv[0] >= 0 && write(sv[0], "x", 1) != 1) bad = 1;
  return bad ? 1 : 0;
}

static long rd(int mem, unsigned long addr, void *buf, size_t n) { ssize_t r = pread(mem, buf, n, (off_t)addr); return r == (ssize_t)n ? 0 : -EFAULT; }
static void reply(int lfd, uint64_t id, long val, int err) {
  struct seccomp_notif_resp r = { .id = id, .val = val, .error = -err };
  (void)ioctl(lfd, SECCOMP_IOCTL_NOTIF_SEND, &r);
}
static int addfd(int lfd, uint64_t id, int fd, unsigned type) {
  struct seccomp_notif_addfd a = { .id = id, .srcfd = fd, .newfd = 0, .flags = 0, .newfd_flags = (type & SOCK_CLOEXEC) ? O_CLOEXEC : 0 };
  int n = ioctl(lfd, SECCOMP_IOCTL_NOTIF_ADDFD, &a); return n < 0 ? -errno : n;
}
static void handle(int lfd, struct seccomp_notif *n) {
  uint64_t id = n->id; char path[64]; snprintf(path, sizeof path, "/proc/%u/mem", n->pid);
  if (n->data.nr != P.socketcall) { reply(lfd, id, 0, ENOSYS); return; }
  long call = (long)n->data.args[0];
  int mem = open(path, O_RDWR | O_CLOEXEC);
  if (mem < 0) { reply(lfd, id, 0, EPERM); return; }
  unsigned long a[4] = { 0 }; size_t words = call == P.call_pair ? 4 : 3;
  if (call != P.call_socket && call != P.call_pair) { reply(lfd, id, 0, EPERM); goto out; }
  long e = rd(mem, n->data.args[1], a, words * sizeof(unsigned long));
  if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_ID_VALID, &id) < 0) goto out;
  if (e) { reply(lfd, id, 0, -e); goto out; }
  int dom = (int)a[0], type = (int)a[1], proto = (int)a[2];
  if (call == P.call_socket) {
    if (dom == P.unix_domain) { reply(lfd, id, 0, EPERM); goto out; }
    int s = socket(dom, type & ~SOCK_CLOEXEC, proto);
    if (s < 0) { reply(lfd, id, 0, errno); goto out; }
    int r = addfd(lfd, id, s, type); close(s);
    if (r < 0) reply(lfd, id, 0, -r); else reply(lfd, id, r, 0);
  } else {
    if (dom == P.unix_domain && (type & P.type_mask) != P.pair_type) { reply(lfd, id, 0, EPERM); goto out; }
    int sv[2];
    if (socketpair(dom, type & ~SOCK_CLOEXEC, proto, sv) < 0) { reply(lfd, id, 0, errno); goto out; }
    int fx = addfd(lfd, id, sv[0], type), fy = fx < 0 ? -1 : addfd(lfd, id, sv[1], type);
    close(sv[0]); close(sv[1]);
    int out_fds[2] = { fx, fy };
    if (fx < 0 || fy < 0) reply(lfd, id, 0, EMFILE);      // a descriptor already installed stays the target's own, with its peer closed
    else if (pwrite(mem, out_fds, sizeof out_fds, (off_t)a[3]) != sizeof out_fds) reply(lfd, id, 0, EFAULT);
    else reply(lfd, id, 0, 0);
  }
out:
  close(mem);
}

int main(int argc, char **argv) {
  int filter_fd = -1, i = 1, do_selftest = 0;
  for (; i < argc; i++) {
    if (!strcmp(argv[i], "--policy") && i + 1 < argc) { if (parse_policy(argv[++i])) { fprintf(stderr, "bad policy\n"); return 125; } }
    else if (!strcmp(argv[i], "--filter-fd") && i + 1 < argc) filter_fd = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--selftest")) do_selftest = 1;
    else if (!strcmp(argv[i], "--")) { i++; break; }
    else { fprintf(stderr, "bad argument %s\n", argv[i]); return 125; }
  }
  if (P.socketcall < 0) { fprintf(stderr, "no policy\n"); return 125; }
  if (do_selftest) return selftest();
  if (filter_fd < 0 || i >= argc) { fprintf(stderr, "usage\n"); return 125; }
  struct stat st; if (fstat(filter_fd, &st) < 0 || st.st_size == 0 || st.st_size % 8 || st.st_size > 4096 * 8) fail("the filter file is empty or not a BPF program");
  struct sock_filter *code = malloc(st.st_size); if (pread(filter_fd, code, st.st_size, 0) != st.st_size) die("read filter");
  close(filter_fd);
  struct sock_fprog prog = { .len = st.st_size / 8, .filter = code };

  pid_t parent = getppid();
  prctl(PR_SET_PDEATHSIG, SIGKILL);
  if (getppid() != parent) return 125;
  int pair[2]; if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, pair) < 0) die("socketpair");
  sigset_t set; sigemptyset(&set); sigaddset(&set, SIGCHLD); sigaddset(&set, SIGTERM); sigaddset(&set, SIGINT); sigaddset(&set, SIGHUP);
  sigprocmask(SIG_BLOCK, &set, NULL);
  pid_t child = fork(); if (child < 0) die("fork");
  if (child == 0) {
    sigprocmask(SIG_UNBLOCK, &set, NULL);
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) die("no_new_privs");
    int l = syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
    if (l < 0) die("seccomp user notification unavailable");
    struct msghdr m = {0}; char b = 'x'; struct iovec io = { &b, 1 }; char cb[CMSG_SPACE(sizeof(int))] = {0};
    m.msg_iov = &io; m.msg_iovlen = 1; m.msg_control = cb; m.msg_controllen = sizeof cb;
    struct cmsghdr *c = CMSG_FIRSTHDR(&m); c->cmsg_level = SOL_SOCKET; c->cmsg_type = SCM_RIGHTS; c->cmsg_len = CMSG_LEN(sizeof(int)); memcpy(CMSG_DATA(c), &l, sizeof(int));
    if (sendmsg(pair[1], &m, 0) != 1) die("send listener");
    close(l); close(pair[0]); close(pair[1]);
    execvp(argv[i], argv + i); die("exec");
  }
  close(pair[1]);
  struct msghdr m = {0}; char b; struct iovec io = { &b, 1 }; char cb[CMSG_SPACE(sizeof(int))];
  m.msg_iov = &io; m.msg_iovlen = 1; m.msg_control = cb; m.msg_controllen = sizeof cb;
  int lfd = -1;
  if (recvmsg(pair[0], &m, 0) == 1) { struct cmsghdr *c = CMSG_FIRSTHDR(&m); if (c && c->cmsg_type == SCM_RIGHTS) memcpy(&lfd, CMSG_DATA(c), sizeof(int)); }
  close(pair[0]);
  if (lfd < 0) { int s; waitpid(child, &s, 0); return 125; }
  int sfd = signalfd(-1, &set, SFD_CLOEXEC);
  struct pollfd pf[2] = { { lfd, POLLIN, 0 }, { sfd, POLLIN, 0 } };
  for (;;) {
    if (poll(pf, 2, -1) < 0 && errno != EINTR) die("poll");
    if (pf[1].revents & POLLIN) {
      struct signalfd_siginfo si; if (read(sfd, &si, sizeof si) == sizeof si) {
        if (si.ssi_signo == SIGCHLD) { int s; if (waitpid(child, &s, WNOHANG) == child) return WIFEXITED(s) ? WEXITSTATUS(s) : 128 + WTERMSIG(s); }
        else kill(child, si.ssi_signo);
      }
    }
    if (pf[0].revents & POLLIN) {
      struct seccomp_notif n; memset(&n, 0, sizeof n);
      if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_RECV, &n) == 0) handle(lfd, &n);
    }
    if (pf[0].revents & (POLLHUP | POLLERR)) pf[0].fd = -1;
  }
}
