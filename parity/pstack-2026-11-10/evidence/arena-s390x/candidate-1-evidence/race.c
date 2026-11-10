// TOCTOU test: thread B flips the socketcall argument block between a permitted and a refused value while thread A
// issues socketcall(SOCKET) / socketcall(SOCKETPAIR) on it. Any returned fd that is AF_UNIX (socket) or a non-stream
// AF_UNIX pair is a policy escape.
#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#define CALL 102
static volatile unsigned long args[4]; static volatile int stop;
static void *flip(void *x) { (void)x; unsigned long i = 0; while (!stop) { args[0] = (i++ & 1) ? AF_UNIX : AF_INET; args[1] = SOCK_STREAM; } return 0; }
static void *flip_pair(void *x) { (void)x; unsigned long i = 0; while (!stop) { args[0] = AF_UNIX; args[1] = (i++ & 1) ? SOCK_STREAM : SOCK_DGRAM; } return 0; }
static int opt(int fd, int o) { int v = -1; socklen_t l = sizeof v; getsockopt(fd, SOL_SOCKET, o, &v, &l); return v; }
int main(int argc, char **argv) {
  int n = argc > 1 ? atoi(argv[1]) : 20000; pthread_t t; long ok = 0, eperm = 0, escapes = 0, other = 0;
  pthread_create(&t, 0, flip, 0);
  for (int i = 0; i < n; i++) {
    unsigned long a[4] = { args[0], args[1], 0, 0 }; (void)a;
    long r = syscall(CALL, 1, args);
    if (r >= 0) { ok++; if (opt(r, SO_DOMAIN) == AF_UNIX) escapes++; close(r); } else if (errno == EPERM) eperm++; else other++;
  }
  stop = 1; pthread_join(t, 0); printf("socket race: n=%d ok=%ld eperm=%ld other=%ld ESCAPES(AF_UNIX returned)=%ld\n", n, ok, eperm, other, escapes);
  stop = 0; ok = eperm = escapes = other = 0; static int sv[2]; args[3] = (unsigned long)sv; pthread_create(&t, 0, flip_pair, 0);
  for (int i = 0; i < n; i++) {
    unsigned long saved3 = args[3]; (void)saved3; args[2] = 0; args[3] = (unsigned long)sv;
    long r = syscall(CALL, 8, args);
    if (r >= 0) { ok++; if (opt(sv[0], SO_DOMAIN) == AF_UNIX && opt(sv[0], SO_TYPE) != SOCK_STREAM) escapes++; close(sv[0]); close(sv[1]); } else if (errno == EPERM) eperm++; else other++;
  }
  stop = 1; pthread_join(t, 0); printf("socketpair race: n=%d ok=%ld eperm=%ld other=%ld ESCAPES(non-stream AF_UNIX pair)=%ld\n", n, ok, eperm, other, escapes);
  return 0;
}
