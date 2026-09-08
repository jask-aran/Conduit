import json
import os
import tempfile
import unittest

os.environ.setdefault("CONDUIT_CHATGPT_WEB_COOKIE_FILE", tempfile.mktemp())

from chatgpt_web_sidecar import SseDecoder, parse_cookie_header, solve_pow


class SidecarProtocolTests(unittest.TestCase):
    def test_cookie_parser_requires_session_token(self):
        with self.assertRaisesRegex(ValueError, "session cookie"):
            parse_cookie_header("_puid=user")
        self.assertEqual(parse_cookie_header("_puid=user; __Secure-next-auth.session-token=secret"), {
            "_puid": "user", "__Secure-next-auth.session-token": "secret",
        })

    def test_cookie_parser_joins_browser_chunked_session_token(self):
        self.assertEqual(parse_cookie_header(
            "unrelated=discarded; __Secure-next-auth.session-token.1=second; "
            "_puid=user; __Secure-next-auth.session-token.0=first; oai-sc=challenge"
        ), {
            "__Secure-next-auth.session-token": "firstsecond",
            "_puid": "user",
            "oai-sc": "challenge",
        })

    def test_cookie_parser_rejects_incomplete_session_token_chunks(self):
        with self.assertRaisesRegex(ValueError, "chunks are incomplete"):
            parse_cookie_header("__Secure-next-auth.session-token.0=first; __Secure-next-auth.session-token.2=third")

    def test_v1_sse_decoder_emits_only_assistant_text(self):
        decoder = SseDecoder()
        initial = {"conversation_id": "c1", "v": {"message": {"id": "m1", "author": {"role": "assistant"}, "content": {"parts": ["Hi"]}}}}
        self.assertEqual(decoder.feed("data: " + json.dumps(initial)), ["Hi"])
        self.assertEqual(decoder.feed('data: {"o":"append","p":"/message/content/parts/0","v":"!"}'), ["!"])
        self.assertEqual((decoder.conversation_id, decoder.message_id), ("c1", "m1"))

    def test_pow_vector(self):
        config = [0] * 18
        token = solve_pow("seed", "ff", config, limit=1)
        self.assertTrue(token.startswith("gAAAAAB"))


if __name__ == "__main__":
    unittest.main()
