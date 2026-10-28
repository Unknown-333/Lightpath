import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from lightpath_agent.config import read_config
from lightpath_agent.transport import Transport

BASE = {"LIGHTPATH_URL": "http://127.0.0.1:4000/", "LIGHTPATH_TOKEN": "tok"}


class ConfigTest(unittest.TestCase):
    def test_off_without_env(self):
        config, reason = read_config({})
        self.assertIsNone(config)
        self.assertIn("not launched", reason)

    def test_refuses_non_local_daemon(self):
        config, _ = read_config({**BASE, "LIGHTPATH_URL": "http://evil.example:4000"})
        self.assertIsNone(config)

    def test_parses_roots_and_url(self):
        config, _ = read_config({**BASE, "LIGHTPATH_ROOTS": "C:\\repo, /srv/app", "LIGHTPATH_DEBUG": "1"})
        self.assertEqual(config.url, "http://127.0.0.1:4000")
        self.assertEqual(config.roots, ["C:\\repo", "/srv/app"])
        self.assertTrue(config.debug)


class _Handler(BaseHTTPRequestHandler):
    received: list = []

    def do_POST(self):  # noqa: N802 - http.server naming
        body = self.rfile.read(int(self.headers["content-length"]))
        _Handler.received.append((self.path, self.headers["authorization"], json.loads(body)))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        pass


class TransportTest(unittest.TestCase):
    def setUp(self):
        _Handler.received = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_posts_batches_with_the_token(self):
        transport = Transport(f"http://127.0.0.1:{self.server.server_port}", "secret", "py-1")
        transport.send({"type": "lines", "pid": 1, "startedAt": 0, "endedAt": 1, "files": []})
        self.assertTrue(transport.flush(5))
        path, auth, batch = _Handler.received[0]
        self.assertEqual(path, "/v1/ingest")
        self.assertEqual(auth, "Bearer secret")
        self.assertEqual(batch["protocolVersion"], 1)
        self.assertEqual(batch["agentId"], "py-1")
        self.assertEqual(batch["messages"][0]["type"], "lines")

    def test_unreachable_daemon_drops_instead_of_blocking(self):
        transport = Transport("http://127.0.0.1:9", "secret", "py-1")
        transport.send({"type": "lines"})
        self.assertTrue(transport.flush(5))
        self.assertEqual(transport.dropped, 1)


if __name__ == "__main__":
    unittest.main()
