"""Sends ingest batches to the daemon from a background thread (ADR 0006)."""

from __future__ import annotations

import json
import queue
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable

PROTOCOL_VERSION = 1
_MAX_QUEUE = 1000
_MAX_BATCH = 200


class Transport:
    """Never blocks the request thread. Drops the oldest messages if the daemon is unreachable."""

    def __init__(self, url: str, token: str, agent_id: str, log: Callable[[str], None] = lambda _m: None) -> None:
        self._endpoint = f"{url}/v1/ingest"
        self._token = token
        self._agent_id = agent_id
        self._log = log
        self._queue: queue.Queue[dict[str, object]] = queue.Queue(maxsize=_MAX_QUEUE)
        self.dropped = 0
        threading.Thread(target=self._run, name="lightpath-transport", daemon=True).start()

    def send(self, message: dict[str, object]) -> None:
        while True:
            try:
                self._queue.put_nowait(message)
                return
            except queue.Full:
                try:
                    self._queue.get_nowait()
                    self._queue.task_done()
                    self.dropped += 1
                except queue.Empty:
                    pass

    def flush(self, timeout: float = 2.0) -> bool:
        """Waits until everything queued has been sent (or dropped). Returns False on timeout."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks:
            if time.monotonic() > deadline:
                return False
            time.sleep(0.01)
        return True

    def _run(self) -> None:
        while True:
            batch = [self._queue.get()]
            while len(batch) < _MAX_BATCH:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            try:
                self._post(batch)
            finally:
                for _ in batch:
                    self._queue.task_done()

    def _post(self, messages: list[dict[str, object]]) -> None:
        body = json.dumps({"protocolVersion": PROTOCOL_VERSION, "agentId": self._agent_id, "messages": messages})
        request = urllib.request.Request(
            self._endpoint,
            data=body.encode("utf-8"),
            method="POST",
            headers={"content-type": "application/json", "authorization": f"Bearer {self._token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:  # noqa: S310 - loopback URL checked in config
                response.read()
        except (urllib.error.URLError, OSError) as err:
            self.dropped += len(messages)
            self._log(f"send failed: {err}")
