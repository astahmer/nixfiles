#!/usr/bin/env python3

import importlib.util
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sync_module_path = Path(__file__).with_name("sync-web-profile.py")
sync_module_spec = importlib.util.spec_from_file_location(
    "sync_web_profile", sync_module_path
)
if sync_module_spec is None or sync_module_spec.loader is None:
    raise RuntimeError(f"Could not load {sync_module_path}")
sync_web_profile = importlib.util.module_from_spec(sync_module_spec)
sync_module_spec.loader.exec_module(sync_web_profile)


class BoundedProfileInstallTests(unittest.TestCase):
    def test_timeout_terminates_child_process_group(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            marker_path = Path(temporary_directory) / "child-survived"
            child_script = (
                "import pathlib, signal, sys, time; "
                "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                "time.sleep(0.7); "
                "pathlib.Path(sys.argv[1]).write_text('survived')"
            )
            parent_script = (
                "import subprocess, sys, time; "
                "subprocess.Popen([sys.executable, '-c', sys.argv[2], sys.argv[1]]); "
                "time.sleep(10)"
            )

            original_term_grace = sync_web_profile.PROCESS_TERM_GRACE_SECONDS
            sync_web_profile.PROCESS_TERM_GRACE_SECONDS = 0.1
            try:
                with self.assertRaises(TimeoutError):
                    sync_web_profile.run_bounded(
                        [
                            sys.executable,
                            "-c",
                            parent_script,
                            str(marker_path),
                            child_script,
                        ],
                        os.environ.copy(),
                        0.2,
                        "test subprocess",
                    )
            finally:
                sync_web_profile.PROCESS_TERM_GRACE_SECONDS = original_term_grace

            time.sleep(0.8)
            self.assertFalse(marker_path.exists())


if __name__ == "__main__":
    unittest.main()
