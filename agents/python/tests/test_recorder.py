import asyncio
import os
import unittest

from lightpath_agent.agent import Agent
from lightpath_agent.asgi import LightpathASGIMiddleware
from lightpath_agent.recorder import Recorder
from lightpath_agent.wsgi import LightpathMiddleware

from . import fixture_app
from .fixture_app import line_of

FIXTURE = os.path.abspath(fixture_app.__file__).replace("\\", "/")
TESTS_DIR = os.path.dirname(os.path.abspath(fixture_app.__file__))


def lines_in_fixture(files):
    for f in files:
        if os.path.normcase(f["path"]) == os.path.normcase(FIXTURE):
            return f["lines"]
    return []


class RecorderTest(unittest.TestCase):
    def setUp(self):
        self.recorder = Recorder([TESTS_DIR])
        self.recorder.start()

    def tearDown(self):
        self.recorder.stop()

    def test_records_taken_branch_in_first_hit_order(self):
        rec = self.recorder.begin()
        fixture_app.shipping(20)
        self.recorder.end(rec)
        lines = lines_in_fixture(rec.files())
        self.assertEqual(lines, [line_of("test"), line_of("standard")])
        self.assertNotIn(line_of("free"), lines)

    def test_rearms_lines_for_each_request(self):
        for _ in range(2):
            rec = self.recorder.begin()
            fixture_app.shipping(500)
            self.recorder.end(rec)
            self.assertEqual(lines_in_fixture(rec.files()), [line_of("test"), line_of("free")])

    def test_ignores_code_outside_the_roots(self):
        rec = self.recorder.begin()
        os.path.join("a", "b")  # standard library: outside the roots
        fixture_app.shipping(1)
        self.recorder.end(rec)
        # normcase also converts / to \ on Windows, so both sides go through it.
        root = os.path.normcase(TESTS_DIR)
        paths = [os.path.normcase(f["path"]) for f in rec.files()]
        self.assertTrue(paths, "expected at least the fixture file")
        self.assertTrue(all(p.startswith(root) for p in paths), paths)

    def test_marks_overlapping_requests(self):
        a = self.recorder.begin()
        b = self.recorder.begin()
        self.recorder.end(a)
        self.recorder.end(b)
        self.assertTrue(a.overlapped and b.overlapped)


class MiddlewareTest(unittest.TestCase):
    def setUp(self):
        self.recorder = Recorder([TESTS_DIR])
        self.recorder.start()
        self.sent = []
        self.agent = Agent(self.recorder, self.sent.append)

    def tearDown(self):
        self.recorder.stop()

    def test_wsgi_reports_lines_status_and_trace_id(self):
        app = LightpathMiddleware(fixture_app.wsgi_app, agent=self.agent)
        environ = {"REQUEST_METHOD": "POST", "PATH_INFO": "/api/orders", "HTTP_X_LIGHTPATH_TRACE": "t_abc123def456"}
        body = app(environ, lambda status, headers, exc_info=None: None)
        self.assertEqual(b"".join(body), b"5")
        self.assertEqual(self.sent, [])  # nothing sent until the server closes the body
        body.close()

        (message,) = self.sent
        self.assertEqual(message["type"], "lines")
        self.assertEqual(message["traceId"], "t_abc123def456")
        self.assertEqual(message["request"], {"method": "POST", "path": "/api/orders", "status": 201})
        lines = lines_in_fixture(message["files"])
        self.assertEqual(lines[:3], [line_of("handler"), line_of("test"), line_of("standard")])

    def test_wsgi_ignores_invalid_trace_ids(self):
        app = LightpathMiddleware(fixture_app.wsgi_app, agent=self.agent)
        app({"HTTP_X_LIGHTPATH_TRACE": "../../etc"}, lambda *a: None).close()
        self.assertNotIn("traceId", self.sent[0])

    def test_asgi_reports_lines_and_status(self):
        app = LightpathASGIMiddleware(fixture_app.asgi_app, agent=self.agent)
        scope = {"type": "http", "method": "GET", "path": "/api/quote", "headers": [(b"x-lightpath-trace", b"t_abc123def456")]}

        async def receive():
            return {"type": "http.request"}

        async def send(_message):
            pass

        asyncio.run(app(scope, receive, send))
        (message,) = self.sent
        self.assertEqual(message["request"], {"method": "GET", "path": "/api/quote", "status": 200})
        self.assertIn(line_of("free"), lines_in_fixture(message["files"]))


if __name__ == "__main__":
    unittest.main()
