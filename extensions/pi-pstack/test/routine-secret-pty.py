import errno
import json
import os
import pty
import select
import signal
import sys
import termios
import time

node, helper, directory, mode = sys.argv[1:]
pid, master = pty.fork()
if pid == 0:
    os.execv(node, [node, helper, directory])

output = b''
deadline = time.monotonic() + 10
sent = False
hidden = False
status = None
value = b'fixture-terminal-key-with-32-characters'
while time.monotonic() < deadline:
    ready, _, _ = select.select([master], [], [], 0.02)
    if ready:
        try:
            output += os.read(master, 4096)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
    if not sent and b'characters): ' in output:
        hidden = not bool(termios.tcgetattr(master)[3] & termios.ECHO)
        if mode == 'interrupt':
            os.kill(pid, signal.SIGTERM)
        else:
            os.write(master, value + b'\n')
        sent = True
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        break
else:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    raise RuntimeError('Secret helper did not finish')
restored = bool(termios.tcgetattr(master)[3] & termios.ECHO)
os.close(master)
print(json.dumps({'hidden': hidden, 'restored': restored, 'exposed': value in output, 'exit': os.waitstatus_to_exitcode(status)}))
