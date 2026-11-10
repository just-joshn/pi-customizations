# Install a notify filter, close the listener (= supervisor gone), then see what glibc's socket() returns.
import ctypes, os, socket, struct, errno, sys
libc = ctypes.CDLL(None, use_errno=True); libc.syscall.restype = ctypes.c_long
bpf = open("/tmp/broker.bpf", "rb").read()
class Prog(ctypes.Structure): _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]
buf = ctypes.create_string_buffer(bpf); prog = Prog(len(bpf) // 8, ctypes.addressof(buf))
libc.prctl(38, 1, 0, 0, 0)
fd = libc.syscall(348, 1, 1 << 3, ctypes.byref(prog)); print("listener fd", fd)
os.close(fd)
for name, fn in (("glibc socket(AF_INET)", lambda: socket.socket(socket.AF_INET)), ("glibc socketpair(AF_UNIX,STREAM)", lambda: socket.socketpair()), ("direct socket syscall(AF_INET)", lambda: libc.syscall(359, 2, 1, 0))):
    try: r = fn(); print(name, "->", r)
    except OSError as e: print(name, "->", errno.errorcode.get(e.errno, e.errno))
