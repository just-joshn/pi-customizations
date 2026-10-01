#!/usr/bin/env python3
import os
import select
import signal
import sys


def stop_owned_child(directory, owner, pid):
    try:
        descriptor = os.pidfd_open(pid)
    except ProcessLookupError:
        return
    try:
        process = f'/proc/{pid}'
        if os.stat(process).st_uid != os.getuid():
            raise RuntimeError('Orphan writer has a different owner.')
        with open(f'{process}/environ', 'rb') as stream:
            environment = stream.read().split(b'\0')
        expected = f'PI_PSTACK_WORKER_OWNER={owner}'.encode()
        cwd = os.path.realpath(f'{process}/cwd')
        executable = os.path.basename(os.path.realpath(f'{process}/exe'))
        if expected not in environment or executable not in ('node', 'nodejs') or not (cwd == f'{directory}/worktree' or cwd.startswith(f'{directory}/worktree/')):
            raise RuntimeError('Orphan writer identity cannot be verified. Reconcile it explicitly.')
        signal.pidfd_send_signal(descriptor, signal.SIGTERM)
        poller = select.poll()
        poller.register(descriptor, select.POLLIN)
        if not poller.poll(10000):
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
            if not poller.poll(10000):
                raise RuntimeError('Orphan writer did not exit.')
    except FileNotFoundError:
        return
    finally:
        os.close(descriptor)


try:
    stop_owned_child(sys.argv[1], sys.argv[2], int(sys.argv[3]))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
