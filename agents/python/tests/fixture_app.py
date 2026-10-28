"""Code under test. Comments ending in `# mark: <name>` let tests find line numbers."""

from pathlib import Path


def shipping(total):
    if total > 100:  # mark: test
        return 0  # mark: free
    return 5  # mark: standard


def wsgi_app(environ, start_response):
    cost = shipping(20)  # mark: handler
    start_response("201 Created", [("content-type", "text/plain")])
    return [str(cost).encode()]


async def asgi_app(scope, receive, send):
    cost = shipping(500)  # mark: async-handler
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": str(cost).encode()})


def line_of(name: str) -> int:
    for number, text in enumerate(Path(__file__).read_text(encoding="utf-8").splitlines(), start=1):
        if text.rstrip().endswith(f"# mark: {name}"):
            return number
    raise LookupError(name)
