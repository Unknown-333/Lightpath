"""Per-request line recording with sys.monitoring (PEP 669). See docs/ARCHITECTURE.md section 5.3."""

from __future__ import annotations

import os
import sys
import threading
import time
from dataclasses import dataclass, field

# Tool IDs 3 and 4 are unassigned by Python, so debuggers (0), coverage tools (1), and
# profilers (2) keep their own slots and can run alongside Lightpath.
_PREFERRED_TOOL_IDS = (3, 4)
_AGENT_DIR = os.path.normcase(os.path.dirname(os.path.abspath(__file__)))


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


@dataclass
class Recording:
    """Lines hit while one request ran, in first-hit order."""

    started_at: float = field(default_factory=lambda: time.time() * 1000)
    hits: list[tuple[str, int]] = field(default_factory=list)
    overlapped: bool = False

    def files(self) -> list[dict[str, object]]:
        """Groups hits by file, keeping first-hit order and dropping repeats."""
        seen: set[tuple[str, int]] = set()
        by_file: dict[str, list[int]] = {}
        for hit in self.hits:
            if hit in seen:
                continue
            seen.add(hit)
            by_file.setdefault(hit[0], []).append(hit[1])
        return [{"path": path.replace("\\", "/"), "lines": lines} for path, lines in by_file.items()]


class Recorder:
    """
    Records which project lines run between begin() and end().

    The LINE callback returns DISABLE every time, so each code location costs one callback and
    is then switched off. begin() calls restart_events() to switch everything back on. Idle code
    between requests costs nothing after its first run.

    Caveats:
    - restart_events() is global: it also re-arms locations other sys.monitoring tools disabled.
    - Recording is per interpreter, not per request. Overlapping requests (threads or async tasks)
      share hits, and each is marked overlapped.
    """

    def __init__(self, roots: list[str], exclude: list[str] | None = None) -> None:
        self._roots = tuple(_norm(r) for r in roots)
        self._exclude = (*(_norm(e) for e in exclude or []), _AGENT_DIR)
        self._wanted_cache: dict[str, bool] = {}
        self._active: tuple[Recording, ...] = ()
        self._lock = threading.Lock()
        self._tool: int | None = None

    @property
    def running(self) -> bool:
        return self._tool is not None

    def start(self) -> None:
        mon = sys.monitoring
        for tool in _PREFERRED_TOOL_IDS:
            if mon.get_tool(tool) is None:
                mon.use_tool_id(tool, "lightpath")
                self._tool = tool
                break
        else:
            raise RuntimeError("no free sys.monitoring tool id (3 and 4 are taken)")
        mon.register_callback(self._tool, mon.events.LINE, self._on_line)
        mon.set_events(self._tool, mon.events.LINE)

    def stop(self) -> None:
        if self._tool is None:
            return
        mon = sys.monitoring
        mon.set_events(self._tool, 0)
        mon.register_callback(self._tool, mon.events.LINE, None)
        mon.free_tool_id(self._tool)
        self._tool = None

    def begin(self) -> Recording:
        recording = Recording()
        with self._lock:
            if self._active:
                recording.overlapped = True
                for other in self._active:
                    other.overlapped = True
            self._active = (*self._active, recording)
        sys.monitoring.restart_events()
        return recording

    def end(self, recording: Recording) -> None:
        with self._lock:
            self._active = tuple(r for r in self._active if r is not recording)

    def _wanted(self, filename: str) -> bool:
        cached = self._wanted_cache.get(filename)
        if cached is not None:
            return cached
        wanted = False
        if not filename.startswith("<"):
            path = _norm(filename)
            inside = any(path == root or path.startswith(root + os.sep) for root in self._roots)
            excluded = any(path == ex or path.startswith(ex + os.sep) for ex in self._exclude)
            wanted = inside and not excluded and "site-packages" not in path
        self._wanted_cache[filename] = wanted
        return wanted

    def _on_line(self, code, line: int):  # noqa: ANN001 - CodeType, kept untyped for speed
        active = self._active
        if active and self._wanted(code.co_filename):
            hit = (code.co_filename, line)
            for recording in active:
                recording.hits.append(hit)
        return sys.monitoring.DISABLE
