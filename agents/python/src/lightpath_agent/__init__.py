"""
Lightpath agent for Python: records which lines each HTTP request runs and reports them to
the Lightpath daemon started by `lightpath dev`. Standard library only; Python 3.12+.
"""

from __future__ import annotations

import atexit
import os
import sys
import threading

from .agent import Agent
from .config import read_config

__all__ = ["Agent", "LightpathASGIMiddleware", "LightpathMiddleware", "get_agent"]
__version__ = "0.0.1"

_lock = threading.Lock()
_agent: Agent | None = None
_tried = False


def get_agent() -> Agent | None:
    """Returns the process-wide agent, starting it on first use. None when Lightpath isn't running."""
    global _agent, _tried
    if _tried:
        return _agent
    with _lock:
        if _tried:
            return _agent
        _tried = True
        _agent = _start()
        return _agent


def _start() -> Agent | None:
    config, reason = read_config(os.environ)
    debug = os.environ.get("LIGHTPATH_DEBUG") == "1"

    def log(message: str) -> None:
        if debug:
            print(f"[lightpath {os.getpid()}] {message}", file=sys.stderr)

    if config is None:
        log(reason)
        return None
    if sys.version_info < (3, 12):
        log("Lightpath needs Python 3.12+ (sys.monitoring)")
        return None

    from .recorder import Recorder
    from .transport import Transport

    try:
        recorder = Recorder(config.roots)
        recorder.start()
    except Exception as err:  # noqa: BLE001 - the user's app must start regardless
        log(f"agent failed to start: {err}")
        return None
    transport = Transport(config.url, config.token, f"py-{os.getpid()}", log)
    agent = Agent(recorder, transport.send)
    agent.hello()
    atexit.register(transport.flush)
    log(f"agent started, reporting to {config.url}")
    return agent


def __getattr__(name: str):  # noqa: ANN202 - lazy imports keep `import lightpath_agent` cheap
    if name == "LightpathMiddleware":
        from .wsgi import LightpathMiddleware

        return LightpathMiddleware
    if name == "LightpathASGIMiddleware":
        from .asgi import LightpathASGIMiddleware

        return LightpathASGIMiddleware
    raise AttributeError(name)
