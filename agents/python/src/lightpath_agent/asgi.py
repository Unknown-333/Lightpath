"""ASGI middleware for FastAPI, Starlette, and other ASGI apps."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from .agent import Agent

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class LightpathASGIMiddleware:
    """
    Records the lines each HTTP request runs.

        app.add_middleware(LightpathASGIMiddleware)   # FastAPI / Starlette
        app = LightpathASGIMiddleware(app)            # any ASGI app

    Async requests interleave on one thread, so concurrent requests are marked overlapped.
    Does nothing unless the process was started by `lightpath dev`.
    """

    def __init__(self, app: ASGIApp, agent: Agent | None = None) -> None:
        self.app = app
        self._agent = agent

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        from . import get_agent

        agent = self._agent or get_agent()
        if scope.get("type") != "http" or agent is None:
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        trace = headers.get(b"x-lightpath-trace", b"").decode("latin-1") or None
        pending = agent.begin(trace, scope.get("method", "GET"), scope.get("path", "/"))
        status: int | None = None

        async def recording_send(message: Message) -> None:
            nonlocal status
            if message.get("type") == "http.response.start":
                status = message.get("status")
            await send(message)

        try:
            await self.app(scope, receive, recording_send)
        except BaseException:
            status = status or 500
            raise
        finally:
            agent.finish(pending, status)
