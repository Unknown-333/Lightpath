"""Turns request boundaries into `lines` messages (docs/PROTOCOL.md)."""

from __future__ import annotations

import os
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass

from .recorder import Recorder, Recording

_TRACE_ID = re.compile(r"^t_[a-z0-9]{12}$")


@dataclass
class Pending:
    recording: Recording
    trace_id: str | None
    method: str
    path: str


class Agent:
    def __init__(self, recorder: Recorder, send: Callable[[dict[str, object]], None]) -> None:
        self._recorder = recorder
        self._send = send
        self._pid = os.getpid()

    def hello(self) -> None:
        self._send(
            {
                "type": "hello",
                "protocolVersion": 1,
                "kind": "python",
                "pid": self._pid,
                "processTitle": " ".join(sys.argv) or "python",
                "cwd": os.getcwd(),
                "runtime": {"name": "python", "version": sys.version.split()[0]},
            }
        )

    def begin(self, trace_id: str | None, method: str, path: str) -> Pending:
        valid = trace_id if trace_id and _TRACE_ID.match(trace_id) else None
        return Pending(self._recorder.begin(), valid, method, path.split("?", 1)[0] or "/")

    def finish(self, pending: Pending, status: int | None) -> None:
        self._recorder.end(pending.recording)
        message: dict[str, object] = {
            "type": "lines",
            "pid": self._pid,
            "startedAt": pending.recording.started_at,
            "endedAt": time.time() * 1000,
            "request": {"method": pending.method, "path": pending.path, **({"status": status} if status else {})},
            "files": pending.recording.files(),
        }
        if pending.trace_id:
            message["traceId"] = pending.trace_id
        self._send(message)
