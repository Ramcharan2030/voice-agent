from __future__ import annotations

import os
import signal
import subprocess
import sys
from dataclasses import dataclass

from loguru import logger

from api.constants import APP_ROOT_DIR, LIVEKIT_WORKER_MANAGED_BY_API
from api.services.livekit.runtime_config import (
    LiveKitRuntimeSettings,
    effective_livekit_settings,
    livekit_environment,
)


@dataclass(frozen=True)
class LiveKitWorkerStatus:
    managed_by_api: bool
    running: bool
    pid: int | None = None
    message: str | None = None


_worker_process: subprocess.Popen | None = None
_worker_signature: str | None = None


def get_worker_status() -> LiveKitWorkerStatus:
    if not LIVEKIT_WORKER_MANAGED_BY_API:
        return LiveKitWorkerStatus(
            managed_by_api=False,
            running=False,
            message="worker_not_managed_by_api",
        )
    if _worker_process and _worker_process.poll() is None:
        return LiveKitWorkerStatus(
            managed_by_api=True,
            running=True,
            pid=_worker_process.pid,
        )
    return LiveKitWorkerStatus(managed_by_api=True, running=False)


def apply_livekit_worker_settings(
    settings: LiveKitRuntimeSettings | None = None,
) -> LiveKitWorkerStatus:
    settings = settings or effective_livekit_settings()
    if not LIVEKIT_WORKER_MANAGED_BY_API:
        return LiveKitWorkerStatus(
            managed_by_api=False,
            running=False,
            message="worker_not_managed_by_api",
        )

    if not settings.is_livekit:
        stop_livekit_worker()
        return LiveKitWorkerStatus(
            managed_by_api=True,
            running=False,
            message="runtime_pipecat",
        )

    if not settings.configured:
        stop_livekit_worker()
        return LiveKitWorkerStatus(
            managed_by_api=True,
            running=False,
            message="livekit_not_configured",
        )

    signature = settings.worker_signature()
    if (
        _worker_process
        and _worker_process.poll() is None
        and _worker_signature == signature
    ):
        return LiveKitWorkerStatus(
            managed_by_api=True,
            running=True,
            pid=_worker_process.pid,
        )

    stop_livekit_worker()
    _start_livekit_worker(settings, signature)
    return get_worker_status()


def stop_livekit_worker() -> None:
    global _worker_process, _worker_signature

    if not _worker_process:
        _worker_signature = None
        return

    if _worker_process.poll() is None:
        logger.info(f"Stopping managed LiveKit worker pid={_worker_process.pid}")
        _terminate_worker_process_group(_worker_process)
        try:
            _worker_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning(
                f"Managed LiveKit worker pid={_worker_process.pid} did not stop; killing"
            )
            _kill_worker_process_group(_worker_process)
            _worker_process.wait(timeout=5)
    else:
        _terminate_worker_process_group(_worker_process)

    _worker_process = None
    _worker_signature = None


def _terminate_worker_process_group(process: subprocess.Popen) -> None:
    if sys.platform == "win32":
        process.terminate()
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


def _kill_worker_process_group(process: subprocess.Popen) -> None:
    if sys.platform == "win32":
        process.kill()
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _start_livekit_worker(settings: LiveKitRuntimeSettings, signature: str) -> None:
    global _worker_process, _worker_signature

    env = livekit_environment(settings)
    cmd = [sys.executable, "-m", "api.services.livekit.worker", "start"]
    logger.info("Starting managed LiveKit worker")
    _worker_process = subprocess.Popen(
        cmd,
        cwd=str(APP_ROOT_DIR.parent),
        env=env,
        start_new_session=sys.platform != "win32",
    )
    _worker_signature = signature
