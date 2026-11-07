"""Raw syscall probes for the read-only sandbox check. Prints `<probe>: ok` or `<probe>: <errno name>`."""

import ctypes
import errno
import os
import socket
import sys

SOCKETCALL = 102
SYS_SOCKET = 1
ARM_OABI_SYSCALL = 113
ARM_SOCKET = 281
IO_URING_SETUP = 425
AF_UNIX = 1
AF_INET = 2
SOCK_STREAM = 1

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long


def report(name, ret):
    if ret < 0:
        code = ctypes.get_errno()
        print(f"{name}: {errno.errorcode.get(code, code)}")
    else:
        os.close(ret)
        print(f"{name}: ok")


def raw(*args):
    return libc.syscall(*[arg if isinstance(arg, ctypes.Array) else ctypes.c_long(arg) for arg in args])


probe = sys.argv[1]
if probe == "unix":
    try:
        socket.socket(socket.AF_UNIX, socket.SOCK_STREAM).close()
        print("socket-unix: ok")
    except OSError as error:
        print(f"socket-unix: {errno.errorcode.get(error.errno, error.errno)}")
elif probe == "direct":
    report("direct-socket-unix", raw(int(sys.argv[2]), AF_UNIX, SOCK_STREAM, 0))
    report("direct-socket-inet", raw(int(sys.argv[2]), AF_INET, SOCK_STREAM, 0))
elif probe == "socketcall":
    report("socketcall-socket-unix", raw(SOCKETCALL, SYS_SOCKET, (ctypes.c_ulong * 3)(AF_UNIX, SOCK_STREAM, 0)))
elif probe == "indirect":
    report("indirect-socket-unix", raw(ARM_OABI_SYSCALL, ARM_SOCKET, AF_UNIX, SOCK_STREAM, 0))
elif probe == "io_uring":
    report("io_uring_setup", raw(IO_URING_SETUP, 4, ctypes.create_string_buffer(120)))
else:
    sys.exit(f"unknown probe {probe}")
