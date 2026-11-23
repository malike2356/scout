"""Tests for scout_client.py. Run with: python -m unittest test_scout_client -v
Needs eth_account installed (pip install eth_account) for the identity tests."""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from eth_account import Account
from eth_account.messages import encode_defunct

from scout_client import Scout, ScoutApiError, generate_identity_key


def _mock_response(status: int, body: dict) -> MagicMock:
    resp = MagicMock()
    resp.ok = 200 <= status < 300
    resp.status_code = status
    resp.content = json.dumps(body).encode()
    resp.json.return_value = body
    return resp


class ScoutClientTest(unittest.TestCase):
    def test_filter_requires_agent_id(self):
        scout = Scout(api_key="sk_live_test", base_url="http://localhost:4444")
        with self.assertRaises(ValueError):
            scout.filter(prompt="hi", agent_id="")

    def test_filter_sends_no_signature_fields_without_identity_key(self):
        scout = Scout(api_key="sk_live_test", base_url="http://localhost:4444")
        with patch.object(scout._session, "request") as mock_request:
            mock_request.return_value = _mock_response(
                200,
                {
                    "verdict": "allowed",
                    "filtered_prompt": "hi",
                    "risk_level": "low",
                    "distillation": {"layer_1": "", "layer_2": "", "layer_3": ""},
                    "finding_id": None,
                },
            )
            scout.filter(prompt="hi", agent_id="agt_1")
            sent = mock_request.call_args.kwargs["json"]
            self.assertNotIn("signed_message", sent)
            self.assertNotIn("signature", sent)

    def test_generate_identity_key_returns_matching_pair(self):
        private_key, address = generate_identity_key()
        self.assertTrue(private_key.startswith("0x"))
        self.assertEqual(len(private_key), 66)
        self.assertTrue(address.startswith("0x"))
        self.assertEqual(Account.from_key(private_key).address, address)

    def test_filter_auto_signs_a_verifiable_envelope(self):
        private_key, address = generate_identity_key()
        scout = Scout(
            api_key="sk_live_test",
            base_url="http://localhost:4444",
            identity_private_key=private_key,
        )
        with patch.object(scout._session, "request") as mock_request:
            mock_request.return_value = _mock_response(
                200,
                {
                    "verdict": "allowed",
                    "filtered_prompt": "hi",
                    "risk_level": "low",
                    "distillation": {"layer_1": "", "layer_2": "", "layer_3": ""},
                    "finding_id": None,
                },
            )
            scout.filter(prompt="hi there", agent_id="agt_1")
            sent = mock_request.call_args.kwargs["json"]

        envelope = json.loads(sent["signed_message"])
        self.assertEqual(envelope["agent_id"], "agt_1")
        self.assertEqual(envelope["prompt"], "hi there")

        recovered = Account.recover_message(
            encode_defunct(text=sent["signed_message"]), signature=sent["signature"]
        )
        self.assertEqual(recovered, address)

    def test_track_event_signs_with_event_count_one(self):
        private_key, address = generate_identity_key()
        scout = Scout(api_key="sk_live_test", base_url="http://localhost:4444")
        with patch.object(scout._session, "request") as mock_request:
            mock_request.return_value = _mock_response(200, {"accepted": 1, "rejected": 0})
            scout.track_event(agent_id="agt_1", event_type="tool_call_completed", sign_with=private_key)
            sent = mock_request.call_args.kwargs["json"]

        envelope = json.loads(sent["signed_message"])
        self.assertEqual(envelope["event_count"], 1)
        recovered = Account.recover_message(
            encode_defunct(text=sent["signed_message"]), signature=sent["signature"]
        )
        self.assertEqual(recovered, address)

    def test_register_identity_signs_the_challenge_and_posts_the_address(self):
        private_key, address = generate_identity_key()
        scout = Scout(api_key="sk_live_test", base_url="http://localhost:4444")

        with patch.object(scout._session, "request") as mock_request:
            mock_request.side_effect = [
                _mock_response(
                    200,
                    {
                        "agent_id": "agt_1",
                        "nonce": "test-nonce",
                        "message": "scout-identity-register:agt_1:test-nonce",
                        "expires_in_seconds": 300,
                    },
                ),
                _mock_response(
                    200,
                    {
                        "agent_id": "agt_1",
                        "chain_address": address,
                        "tx_hash": None,
                        "explorer_url": None,
                        "verified_onchain": False,
                    },
                ),
            ]
            result = scout.register_identity("agt_1", private_key)

        self.assertEqual(result["chain_address"], address)
        register_call = mock_request.call_args_list[1]
        sent = register_call.kwargs["json"]
        self.assertEqual(sent["address"], address)
        self.assertEqual(sent["nonce"], "test-nonce")

        recovered = Account.recover_message(
            encode_defunct(text="scout-identity-register:agt_1:test-nonce"),
            signature=sent["signature"],
        )
        self.assertEqual(recovered, address)

    def test_assert_agent_runnable_reports_global_scope(self):
        scout = Scout(api_key="sk_live_test", base_url="http://localhost:4444")
        with patch.object(scout._session, "request") as mock_request:
            mock_request.return_value = _mock_response(
                200,
                {
                    "agent_id": "agt_1",
                    "status": "online",
                    "kill_switch_active": True,
                    "kill_switch_scope": "global",
                    "suspension_reason": "incident drill",
                },
            )
            with self.assertRaises(ScoutApiError) as ctx:
                scout.assert_agent_runnable("agt_1")

        self.assertEqual(ctx.exception.code, "global_kill_switch")
        self.assertEqual(ctx.exception.body["reason"], "incident drill")


if __name__ == "__main__":
    unittest.main()
