import json
import os
import tempfile
import unittest

os.environ.setdefault("CONDUIT_CHATGPT_WEB_COOKIE_FILE", tempfile.mktemp())

from chatgpt_web_sidecar import SseDecoder, parse_cookie_header, public_chat_models, solve_pow, transport_selection


class SidecarProtocolTests(unittest.TestCase):
    def test_cookie_parser_requires_session_token(self):
        with self.assertRaisesRegex(ValueError, "session cookie"):
            parse_cookie_header("_puid=user")
        self.assertEqual(parse_cookie_header("_puid=user; __Secure-next-auth.session-token=secret"), {
            "_puid": "user", "__Secure-next-auth.session-token": "secret",
        })

    def test_cookie_parser_preserves_browser_chunked_session_token(self):
        self.assertEqual(parse_cookie_header(
            "unrelated=discarded; __Secure-next-auth.session-token.1=second; "
            "_puid=user; __Secure-next-auth.session-token.0=first; oai-sc=challenge"
        ), {
            "__Secure-next-auth.session-token.1": "second",
            "__Secure-next-auth.session-token.0": "first",
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

    def test_catalog_collapses_chat_variants_and_omits_work_models(self):
        items = [
            {"slug": "gpt-5-6", "title": "GPT-5.6 Sol", "reasoning_type": "auto", "is_work_mode_model": False},
            {"slug": "gpt-5-6-instant", "reasoning_type": "none", "is_work_mode_model": False},
            {"slug": "gpt-5-6-thinking", "reasoning_type": "reasoning", "is_work_mode_model": False,
             "thinking_efforts": [{"thinking_effort": "standard"}, {"thinking_effort": "extended"}]},
            {"slug": "gpt-5.6-terra-wm", "title": "GPT-5.6 Terra", "reasoning_type": "reasoning", "is_work_mode_model": True},
        ]
        self.assertEqual(public_chat_models(items), [{"id": "gpt-5-6", "label": "GPT-5.6 Sol",
            "thinkingLevels": ["instant", "medium", "high", "xhigh"], "defaultThinkingLevel": "medium"}])

    def test_public_effort_maps_to_chatgpt_transport_fields(self):
        self.assertEqual(transport_selection("gpt-5-6", "instant"), ("gpt-5-6-instant", ""))
        self.assertEqual(transport_selection("gpt-5-6", "medium"), ("gpt-5-6", ""))
        self.assertEqual(transport_selection("gpt-5-6", "high"), ("gpt-5-6-thinking", "standard"))
        self.assertEqual(transport_selection("gpt-5-6", "xhigh"), ("gpt-5-6-thinking", "extended"))


if __name__ == "__main__":
    unittest.main()
