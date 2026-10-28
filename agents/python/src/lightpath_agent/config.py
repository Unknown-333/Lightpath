"""Reads the environment variables `lightpath dev` sets (same names as the Node agent)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

ENV_URL = "LIGHTPATH_URL"
ENV_TOKEN = "LIGHTPATH_TOKEN"
ENV_ROOTS = "LIGHTPATH_ROOTS"
ENV_DEBUG = "LIGHTPATH_DEBUG"

_LOOPBACK = {"127.0.0.1", "localhost", "::1"}


@dataclass(frozen=True)
class Config:
    url: str
    token: str
    roots: list[str]
    debug: bool


def read_config(env: Mapping[str, str] = os.environ) -> tuple[Config | None, str]:
    """Returns (config, "") or (None, reason the agent stays off)."""
    url = env.get(ENV_URL)
    token = env.get(ENV_TOKEN)
    if not url or not token:
        return None, "not launched by lightpath (no LIGHTPATH_URL/TOKEN)"
    host = urlsplit(url).hostname
    if host not in _LOOPBACK:
        # The daemon only listens on loopback. Never send source paths anywhere else.
        return None, f"{ENV_URL} must point at localhost"
    roots = [r.strip() for r in env.get(ENV_ROOTS, os.getcwd()).split(",") if r.strip()]
    return Config(url=url.rstrip("/"), token=token, roots=roots, debug=env.get(ENV_DEBUG) == "1"), ""
