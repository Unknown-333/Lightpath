"""WSGI middleware for Flask, Django, and other WSGI apps."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator

from .agent import Agent

WSGIApp = Callable[..., Iterable[bytes]]


class LightpathMiddleware:
    """
    Records the lines each request runs.

        app.wsgi_app = LightpathMiddleware(app.wsgi_app)   # Flask
        application = LightpathMiddleware(application)     # Django wsgi.py

    Does nothing unless the process was started by `lightpath dev`.
    """

    def __init__(self, app: WSGIApp, agent: Agent | None = None) -> None:
        self.app = app
        self._agent = agent

    def __call__(self, environ: dict, start_response: Callable) -> Iterable[bytes]:
        from . import get_agent

        agent = self._agent or get_agent()
        if agent is None:
            return self.app(environ, start_response)

        pending = agent.begin(
            environ.get("HTTP_X_LIGHTPATH_TRACE"),
            environ.get("REQUEST_METHOD", "GET"),
            environ.get("PATH_INFO", "/"),
        )
        status: list[int] = []

        def recording_start_response(status_line: str, headers: list, exc_info=None):  # noqa: ANN001
            status[:] = [int(status_line.split(" ", 1)[0])]
            return start_response(status_line, headers, exc_info) if exc_info else start_response(status_line, headers)

        try:
            result = self.app(environ, recording_start_response)
        except BaseException:
            agent.finish(pending, 500)
            raise
        # The body may be a generator that runs more code, so recording ends when the server closes it.
        return _ClosingIterable(result, lambda: agent.finish(pending, status[0] if status else None))


class _ClosingIterable:
    def __init__(self, inner: Iterable[bytes], on_close: Callable[[], None]) -> None:
        self._inner = inner
        self._on_close = on_close
        self._closed = False

    def __iter__(self) -> Iterator[bytes]:
        return iter(self._inner)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            close = getattr(self._inner, "close", None)
            if close:
                close()
        finally:
            self._on_close()
