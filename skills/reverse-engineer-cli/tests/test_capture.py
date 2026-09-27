import contextlib
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import typing
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/probe.py'
SPEC = importlib.util.spec_from_file_location('capture_probe', SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = probe
SPEC.loader.exec_module(probe)


class CaptureFailures(unittest.TestCase):
    def generate(self, root, *options):
        argv = ['probe', '--out', str(root), *options, '--', sys.executable,
                '-c', 'import sys; sys.stdout.write("output"); sys.stdin.buffer.read()']
        with patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(probe.main(), 0)
        return json.loads((root / 'probes.jsonl').read_text())

    def fail_worker_io(self, original, code):
        def operation(*args):
            if threading.current_thread() is not threading.main_thread():
                raise OSError(code, os.strerror(code))
            return original(*args)
        return operation

    def test_stream_outcome_data_annotation_names_immutable_bytes(self):
        self.assertIs(typing.get_type_hints(probe.StreamOutcome)['data'], bytes)

    def test_unexpected_read_error_cannot_claim_complete_capture(self):
        original = os.read
        def read(fd, count):
            data = original(fd, count)
            if data and threading.current_thread() is not threading.main_thread():
                raise OSError(errno.EINVAL, 'injected after target write')
            return data
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(probe.os, 'read', side_effect=read):
                record = self.generate(Path(temp))
            self.assertEqual(record['exit_code'], 0)
            self.assertFalse(record['capture_complete'])
            self.assertEqual(record['capture_outcomes']['stdout']['error']['errno'], errno.EINVAL)
            self.assertEqual(Path(record['stdout']['path']).read_bytes(), b'')

    def test_unexpected_write_error_is_recorded_separately(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(probe.os, 'write', self.fail_worker_io(os.write, errno.EINVAL)):
                record = self.generate(Path(temp), '--stdin-text', 'input')
            self.assertTrue(record['capture_complete'])
            self.assertEqual(record['input_delivery']['status'], 'error')
            self.assertEqual(record['input_delivery']['bytes'], 0)
            self.assertEqual(record['input_delivery']['error']['errno'], errno.EINVAL)

    def test_expected_pipe_closure_is_not_an_input_error(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(probe.os, 'write', self.fail_worker_io(os.write, errno.EPIPE)):
                record = self.generate(Path(temp), '--stdin-text', 'input')
            self.assertEqual(record['input_delivery']['status'], 'closed')
            self.assertIsNone(record['input_delivery']['error'])
            self.assertEqual(record['input_delivery']['bytes'], 0)

    def test_pipe_eio_is_an_error_not_a_pty_eof(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(probe.os, 'read', self.fail_worker_io(os.read, errno.EIO)):
                record = self.generate(Path(temp))
            self.assertFalse(record['capture_complete'])
            self.assertEqual(record['capture_outcomes']['stdout']['error']['errno'], errno.EIO)

    def test_pty_configuration_io_error_is_not_treated_as_eof(self):
        reader, writer = os.openpty()
        result = probe.Future()
        with patch.object(probe.os, 'set_blocking', side_effect=OSError(errno.EIO, 'injected setup failure')):
            probe.stream_task(reader, True, None, threading.Event(), result)
        os.close(writer)
        self.assertEqual(result.result().status, 'error')
        self.assertEqual(result.result().error.errno, errno.EIO)

    def test_writer_counts_partial_delivery_before_failure(self):
        reader, writer = os.pipe()
        original = os.write
        calls = iter((2, OSError(errno.EINVAL, 'injected')))
        def write(fd, data):
            action = next(calls)
            if isinstance(action, OSError):
                raise action
            return original(fd, data[:action])
        result = probe.Future()
        with patch.object(probe.os, 'write', side_effect=write):
            probe.stream_task(writer, False, b'input', threading.Event(), result)
        self.assertEqual(os.read(reader, 10), b'in')
        os.close(reader)
        self.assertEqual(result.result().transferred, 2)
        self.assertEqual(result.result().status, 'error')

    def test_zero_progress_write_preserves_confirmed_partial_delivery(self):
        reader, writer = os.pipe()
        original = os.write
        counts = iter((2, 0))
        def write(fd, data):
            return original(fd, data[:next(counts)])
        result = probe.Future()
        with patch.object(probe.os, 'write', side_effect=write):
            probe.stream_task(writer, False, b'input', threading.Event(), result)
        self.assertEqual(os.read(reader, 10), b'in')
        os.close(reader)
        self.assertEqual(result.result().transferred, 2)
        self.assertEqual(result.result().status, 'error')
        self.assertEqual(result.result().error.message, 'write made no progress')

    def test_zero_progress_write_records_partial_delivery_in_evidence(self):
        original = os.write
        counts = iter((2, 0))
        def write(fd, data):
            if threading.current_thread() is threading.main_thread():
                return original(fd, data)
            return original(fd, data[:next(counts)])
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(probe.os, 'write', side_effect=write):
                record = self.generate(Path(temp), '--stdin-text', 'input')
        self.assertEqual(record['exit_code'], 0)
        self.assertTrue(record['capture_complete'])
        self.assertEqual(record['input_delivery'], {
            'bytes': 2, 'status': 'error',
            'error': {'type': 'RuntimeError', 'errno': None, 'message': 'write made no progress'},
        })

    def test_invalid_signal_and_missing_stdin_fail_cleanly(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for options in (['--send-signal', 'SIG_IGN'], ['--stdin-file', str(root / 'missing')]):
                argv = ['probe', '--out', str(root / 'out'), *options, '--', '/bin/true']
                errors = io.StringIO()
                with patch.object(sys, 'argv', argv), contextlib.redirect_stderr(errors):
                    try:
                        status = probe.main()
                    except SystemExit as error:
                        status = error.code
                self.assertEqual(status, 2)
                self.assertNotIn('Traceback', errors.getvalue())

    def test_pty_configuration_failure_closes_allocated_descriptors(self):
        master, slave = os.openpty()
        with patch.object(probe.pty, 'openpty', return_value=(master, slave)):
            with patch.object(probe.fcntl, 'ioctl', side_effect=OSError(errno.EINVAL, 'injected')):
                with self.assertRaises(OSError):
                    probe.open_pty(80, 24)
        for fd in (master, slave):
            with self.assertRaises(OSError):
                os.fstat(fd)

    def test_pty_cleanup_attempts_both_descriptors_after_close_error(self):
        master, slave = os.openpty()
        original = os.close
        def close(fd):
            original(fd)
            if fd == master:
                raise OSError(errno.EIO, 'injected close failure')
        with patch.object(probe.pty, 'openpty', return_value=(master, slave)):
            with patch.object(probe.fcntl, 'ioctl', side_effect=OSError(errno.EINVAL, 'injected')):
                with patch.object(probe.os, 'close', side_effect=close), self.assertRaises(OSError):
                    probe.open_pty(80, 24)
        for fd in (master, slave):
            with self.assertRaises(OSError):
                os.fstat(fd)

    def test_snapshot_walk_failure_is_not_silent(self):
        def walk(root, **options):
            if 'onerror' in options:
                options['onerror'](PermissionError('injected'))
            return iter(())
        with patch.object(probe.os, 'walk', side_effect=walk):
            with self.assertRaises(PermissionError):
                probe.snapshot(Path('/'))

    def test_overlapping_seed_symlink_never_writes_outside_sandbox(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            outside, first, second = (root / name for name in ('outside', 'first', 'second'))
            for path in (outside, first, second):
                path.mkdir()
            (first / 'nested').symlink_to(outside, target_is_directory=True)
            (second / 'nested').mkdir()
            (second / 'nested/payload').write_text('unsafe')
            with self.assertRaises(ValueError):
                probe.build_sandbox(root / 'sandbox', [f'{first}:work', f'{second}:work'])
            self.assertFalse((outside / 'payload').exists())


if __name__ == '__main__':
    unittest.main()
