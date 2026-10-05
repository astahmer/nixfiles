#!/usr/bin/env python3

import errno
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

LOCK_WAIT_SECONDS = 120
PATCH_START = "# BEGIN NIX-MANAGED DSH PLUGINS"
PATCH_END = "# END NIX-MANAGED DSH PLUGINS"
STATE_FILENAME = ".nixfiles-managed-plugins.json"


def read_object(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def process_exited(record: str) -> bool:
    try:
        process_id = int(record.splitlines()[0])
    except (IndexError, ValueError):
        return False
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    except OSError as error:
        return error.errno == errno.ESRCH
    return False


def take_over_exited_lock(lock_path: Path) -> bool:
    try:
        record = lock_path.read_text(encoding="utf-8")
    except OSError:
        return False
    if not process_exited(record):
        return False

    claim_path = Path(
        f"{lock_path}.takeover-{hashlib.sha256(record.encode()).hexdigest()[:16]}"
    )
    try:
        claim_descriptor = os.open(
            claim_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600
        )
    except FileExistsError:
        return False

    try:
        with os.fdopen(claim_descriptor, "w", encoding="utf-8") as claim:
            claim.write(f"{os.getpid()}\n")
        try:
            current_record = lock_path.read_text(encoding="utf-8")
        except OSError:
            return False
        if current_record != record or not process_exited(record):
            return False
        try:
            lock_path.unlink()
        except OSError:
            return False
        return True
    finally:
        claim_path.unlink(missing_ok=True)


@contextmanager
def profile_lock(manifest_path: Path):
    lock_path = Path(f"{manifest_path}.lock")
    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    delay = 0.02
    acquired = False

    while not acquired:
        try:
            lock_descriptor = os.open(
                lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600
            )
        except FileExistsError:
            if take_over_exited_lock(lock_path):
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError(f"timed out waiting for DSH profile lock: {lock_path}")
            time.sleep(delay)
            delay = min(delay * 2, 0.2)
            continue

        try:
            with os.fdopen(lock_descriptor, "w", encoding="utf-8") as lock_file:
                lock_file.write(f"{os.getpid()}\n")
        except BaseException:
            lock_path.unlink(missing_ok=True)
            raise
        acquired = True

    try:
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def atomic_write(path: Path, content: str) -> None:
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(content)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def managed_patch_region(source: str) -> str:
    if source.count(PATCH_START) != 1 or source.count(PATCH_END) != 1:
        raise ValueError("Nix Cordis patch must contain one managed plugin region")
    start = source.index(PATCH_START)
    end = source.index(PATCH_END, start) + len(PATCH_END)
    return source[start:end]


def reconcile_patch(path: Path, source: str) -> bool:
    target = path.read_text(encoding="utf-8")
    region = managed_patch_region(source)
    starts = target.count(PATCH_START)
    ends = target.count(PATCH_END)

    if starts == 1 and ends == 1:
        start = target.index(PATCH_START)
        end = target.index(PATCH_END, start) + len(PATCH_END)
        updated = f"{target[:start]}{region}{target[end:]}"
    elif starts or ends:
        raise ValueError(f"{path} has an incomplete Nix-managed Cordis region")
    else:
        legacy_region = region.replace(f"{PATCH_START}\n", "", 1).replace(
            f"\n{PATCH_END}", "", 1
        )
        if legacy_region in target:
            updated = target.replace(legacy_region, region, 1)
        elif "id: dshfiles-multi-host" in target:
            return False
        else:
            updated = f"{target.rstrip()}\n\n{region}\n"

    if updated == target:
        return False
    atomic_write(path, updated)
    return True


def install_profile(profile: Path) -> None:
    environment = os.environ.copy()
    pnpm_home = Path.home() / ".local/share/pnpm"
    environment["PNPM_HOME"] = str(pnpm_home)
    environment["PNPM_STORE_DIR"] = str(pnpm_home / "store")
    environment["PATH"] = os.pathsep.join(
        [str(pnpm_home / "bin"), str(pnpm_home), environment.get("PATH", "")]
    )
    subprocess.run(
        [
            "/bin/zsh",
            "-lc",
            'fnm exec --using=v22.23.3 -- pnpm --dir "$1" install',
            "dsh-profile-sync",
            str(profile),
        ],
        check=True,
        env=environment,
    )


def reconcile(profile: Path, source_manifest_path: Path, source_patch_path: Path) -> None:
    manifest_path = profile / "package.json"
    patch_path = profile / "cordis.patch.yml"
    state_path = profile / STATE_FILENAME
    source_manifest = read_object(source_manifest_path)
    source_patch = source_patch_path.read_text(encoding="utf-8")

    desired_dependencies = source_manifest.get("dependencies", {})
    desired_profile = source_manifest.get("dsh", {}).get("profile", {})
    desired_bundles = desired_profile.get("bundles", [])
    if not isinstance(desired_dependencies, dict) or not all(
        isinstance(name, str) and isinstance(version, str)
        for name, version in desired_dependencies.items()
    ):
        raise ValueError("Nix DSH dependencies must map package names to specs")
    if not isinstance(desired_bundles, list) or not all(
        isinstance(bundle, str) for bundle in desired_bundles
    ):
        raise ValueError("Nix DSH bundles must be a list of package names")

    with profile_lock(manifest_path):
        manifest = read_object(manifest_path)
        current_dependencies = manifest.setdefault("dependencies", {})
        current_dsh = manifest.setdefault("dsh", {})
        if not isinstance(current_dependencies, dict) or not isinstance(current_dsh, dict):
            raise ValueError("DSH profile dependencies and dsh settings must be objects")
        current_profile = current_dsh.setdefault("profile", {})
        if not isinstance(current_profile, dict):
            raise ValueError("DSH profile settings must be an object")
        current_bundles = current_profile.setdefault("bundles", [])
        if not isinstance(current_bundles, list) or not all(
            isinstance(bundle, str) for bundle in current_bundles
        ):
            raise ValueError("DSH profile bundles must be a list of package names")

        previous_state = read_object(state_path) if state_path.exists() else {}
        previous_dependencies = previous_state.get("dependencies", {})
        previous_bundles = previous_state.get("bundles", [])
        if not isinstance(previous_dependencies, dict) or not isinstance(previous_bundles, list):
            raise ValueError(f"{state_path} has an invalid managed plugin record")

        for name, previous_spec in previous_dependencies.items():
            if name not in desired_dependencies and current_dependencies.get(name) == previous_spec:
                del current_dependencies[name]
        stale_bundles = set(previous_bundles) - set(desired_bundles)
        current_profile["bundles"] = [
            bundle for bundle in current_bundles if bundle not in stale_bundles
        ]
        current_bundles = current_profile["bundles"]

        current_dependencies.update(desired_dependencies)
        for bundle in desired_bundles:
            if bundle not in current_bundles:
                current_bundles.append(bundle)

        manifest_changed = manifest != read_object(manifest_path)
        if manifest_changed:
            atomic_write(manifest_path, f"{json.dumps(manifest, indent=2)}\n")

        patch_changed = reconcile_patch(patch_path, source_patch)
        new_state = {"dependencies": desired_dependencies, "bundles": desired_bundles}
        state_changed = new_state != previous_state
        needs_install = manifest_changed or state_changed or not state_path.exists()
        if needs_install:
            print("Installing the reconciled DSH web profile plugins.", flush=True)
            install_profile(profile)
        if patch_changed:
            print("Restored the Nix-managed DSH Cordis plugin entries.", flush=True)
        if state_changed:
            atomic_write(state_path, f"{json.dumps(new_state, indent=2)}\n")


if __name__ == "__main__":
    reconcile(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
