import contextlib
from dataclasses import replace
import errno
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from test_capture import probe


class CaptureLifecycle(unittest.TestCase):
    def invocation(self, root, *options):
        parser = probe.argument_parser()
        args = parser.parse_args(['--out', str(root), *options, '--', sys.executable, '-c', 'import time; time.sleep(20)'])
        command = probe.validate_arguments(args, parser)
        return args, probe.prepare_invocation(args, root, 'test', command)

    def assert_closed(self, descriptors):
        for descriptor in descriptors:
            with self.assertRaises(OSError):
                os.fstat(descriptor)

    def test_partial_capture_allocation_closes_prior_pipe(self):
        reader, writer = os.pipe()
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp), '--stdin-text', 'x')
            with patch.object(probe.os, 'pipe', side_effect=[(reader, writer), OSError(errno.EMFILE, 'injected')]):
                with self.assertRaises(OSError):
                    probe.prepare_capture(args, invocation)
        self.assert_closed((reader, writer))

    def test_failed_tty_duplication_closes_both_pty_descriptors(self):
        master, slave = os.openpty()
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp), '--stdin-mode', 'tty')
            with patch.object(probe, 'open_pty', return_value=(master, slave)):
                with patch.object(probe.os, 'dup', side_effect=OSError(errno.EMFILE, 'injected')):
                    with self.assertRaises(OSError):
                        probe.prepare_capture(args, invocation)
        self.assert_closed((master, slave))

    def test_launch_setup_exception_closes_every_capture_descriptor(self):
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp))
            capture = probe.prepare_capture(args, invocation)
            with patch.object(probe.subprocess, 'Popen', side_effect=subprocess.SubprocessError('injected')):
                with self.assertRaises(subprocess.SubprocessError):
                    probe.execute(args, invocation, capture)
            self.assert_closed(capture.owned)

    def test_wait_failure_kills_and_reaps_target(self):
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp), '--stdin-text', 'x')
            capture = probe.prepare_capture(args, invocation)
            process, error = probe.launch(invocation, capture)
            self.assertIsNone(error)
            self.addCleanup(lambda: process.poll() is None and process.kill())
            with patch.object(probe, 'launch', return_value=(process, None)):
                with patch.object(probe, 'wait_for_process', side_effect=OSError(errno.EINVAL, 'injected')):
                    with self.assertRaises(OSError):
                        probe.execute(args, invocation, capture)
            self.assertIsNotNone(process.poll())
            self.assertTrue(all(not thread.is_alive() for thread in capture.threads))
            self.assert_closed(capture.owned)

    def test_thread_start_failure_unwinds_started_and_unstarted_workers(self):
        original = threading.Thread.start
        attempts = iter((True, False))
        def start(thread):
            if next(attempts):
                return original(thread)
            raise RuntimeError('cannot start new thread')
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp), '--stdin-text', 'input')
            capture = probe.prepare_capture(args, invocation)
            with patch.object(probe.threading.Thread, 'start', start):
                with self.assertRaises(OSError):
                    probe.execute(args, invocation, capture)
            self.assert_closed(capture.owned)
            self.assertTrue(all(not thread.is_alive() for thread in capture.threads))

    def test_execution_metadata_does_not_expose_mutable_aliases(self):
        with tempfile.TemporaryDirectory() as temp:
            args, invocation = self.invocation(Path(temp), '--send-signal', 'TERM', '--after', '.05')
            capture = probe.prepare_capture(args, invocation)
            execution = probe.execute(args, invocation, capture)
            probe.finish_capture(capture, execution)
            with self.assertRaises(TypeError):
                execution.signal_sent['signal'] = 'SIGKILL'
            missing = replace(invocation, command=(str(Path(temp) / 'missing'),))
            capture = probe.prepare_capture(args, missing)
            execution = probe.execute(args, missing, capture)
            probe.finish_capture(capture, execution)
            with self.assertRaises(TypeError):
                execution.launch_error['message'] = 'changed'

    def test_cancelled_reader_publishes_only_immutable_completed_data(self):
        reader, writer = os.pipe()
        stop, received, result = threading.Event(), threading.Event(), probe.Future()
        original = os.read
        def read(fd, count):
            data = original(fd, count)
            if fd == reader and data:
                received.set()
            return data
        thread = threading.Thread(target=probe.stream_task, args=(reader, False, None, stop, result), daemon=True)
        with patch.object(probe.os, 'read', side_effect=read):
            thread.start()
            try:
                os.write(writer, b'partial')
                self.assertTrue(received.wait(timeout=2), 'worker did not read the input')
            finally:
                stop.set()
                thread.join(timeout=2)
                os.close(writer)
        self.assertFalse(thread.is_alive())
        outcome = result.result(timeout=2)
        self.assertEqual(outcome.status, 'cancelled')
        self.assertEqual(outcome.data, b'partial')
        self.assertEqual(outcome.transferred, 7)
        self.assertIsInstance(outcome.data, bytes)
        with self.assertRaises(AttributeError):
            outcome.status = 'complete'

    def test_snapshot_failure_has_a_clean_cli_error(self):
        for before in (True, False):
            with self.subTest(before=before), tempfile.TemporaryDirectory() as temp:
                argv = ['probe', '--out', temp, '--isolate', '--', sys.executable, '-c', 'pass']
                errors = io.StringIO()
                failure = PermissionError('injected snapshot failure')
                outcomes = [failure] if before else [{}, failure]
                with patch.object(sys, 'argv', argv), contextlib.redirect_stderr(errors):
                    with patch.object(probe, 'snapshot', side_effect=outcomes):
                        self.assertEqual(probe.main(), 2)
                self.assertIn('injected snapshot failure', errors.getvalue())
                self.assertFalse((Path(temp) / 'probes.jsonl').exists())

    def test_stdin_modes_and_confirmed_tty_eof(self):
        with tempfile.TemporaryDirectory() as temp:
            for mode, code, expected in (
                ('closed', 'import os;\ntry: os.fstat(0)\nexcept OSError: print("closed")', b'closed\n'),
                ('inherit', 'print("inherited")', b'inherited\n'),
                ('tty', 'import sys; print(sys.stdin.readline().strip())', b'input\n')):
                result = subprocess.run([sys.executable, str(Path(probe.__file__)), '--out', temp,
                                         '--stdin-mode', mode, '--stdin-text', 'input\n', '--', sys.executable, '-c', code],
                                        capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                record = json.loads((Path(temp) / 'probes.jsonl').read_text().splitlines()[-1])
                self.assertEqual(Path(record['stdout']['path']).read_bytes(), expected)
                self.assertEqual(record['stdin']['tty_eof_sent'], mode == 'tty')
                self.assertTrue(record['capture_complete'])

    def test_resistant_target_escalates_and_descendant_output_is_reported(self):
        scripts = ('import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(20)',
                   'import os,time; pid=os.fork(); time.sleep(20) if pid == 0 else None')
        with tempfile.TemporaryDirectory() as temp:
            for index, code in enumerate(scripts):
                result = subprocess.run([sys.executable, str(Path(probe.__file__)), '--out', temp,
                                         '--timeout', '0.5', '--', sys.executable, '-c', code],
                                        capture_output=True, timeout=12)
                self.assertEqual(result.returncode, 0, result.stderr)
                record = json.loads((Path(temp) / 'probes.jsonl').read_text().splitlines()[-1])
                self.assertTrue(record['capture_complete'])
                if index == 0:
                    self.assertTrue(record['timed_out'])
                    self.assertEqual(record['signal'], 'SIGKILL')
                else:
                    self.assertTrue(record['descendants_hold_output'])
                    self.assertEqual(record['exit_code'], 0)


if __name__ == '__main__':
    unittest.main()
