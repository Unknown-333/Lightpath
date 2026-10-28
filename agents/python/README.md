# lightpath-agent

Python agent for [Lightpath](https://github.com/Unknown-333/Lightpath). It records which lines of your code each HTTP request ran and sends them to the Lightpath daemon, so they light up in your editor next to the frontend code that made the request.

- Python 3.12+ (uses `sys.monitoring`). Standard library only.
- Does nothing unless the process was started by `lightpath dev`.
- Records only files inside your workspace, never `site-packages`.
- Lines are reported in the order they first ran. Counts aren't available (each line reports once per request).

## Use it

Flask:

```python
from lightpath_agent import LightpathMiddleware
app.wsgi_app = LightpathMiddleware(app.wsgi_app)
```

Django (`wsgi.py`):

```python
from lightpath_agent import LightpathMiddleware
application = LightpathMiddleware(get_wsgi_application())
```

FastAPI or Starlette:

```python
from lightpath_agent import LightpathASGIMiddleware
app.add_middleware(LightpathASGIMiddleware)
```

Then run your server under Lightpath: `lightpath dev -- uvicorn main:app --reload`.

## Limits

- Recording is per interpreter. Requests that overlap (threads or async tasks) share hits and are marked as overlapped.
- `sys.monitoring.restart_events()` is global, so other tools using `sys.monitoring` may see extra events while Lightpath runs.

## Test

From the repo root: `python -m unittest discover -s agents/python/tests -t agents/python`
