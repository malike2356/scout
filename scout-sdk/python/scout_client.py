"""Minimal Python client for the Scout runtime security API."""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

DEFAULT_BASE_URL = "https://console.labyrinthscout.com"
DEFAULT_TIMEOUT_SECONDS = 10


def _require_eth_account():
    """Lazily imports eth_account so the base client only needs `requests`
    unless you actually use the on-chain identity feature (generate_identity_key,
    register_identity, or passing identity_private_key/sign_with)."""
    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct

        return Account, encode_defunct
    except ImportError as exc:  # pragma: no cover - exercised only without the dep
        raise ImportError(
            "Scout's on-chain identity feature needs eth_account: pip install eth_account"
        ) from exc


def _as_0x(value: str) -> str:
    return value if value.startswith("0x") else f"0x{value}"


def generate_identity_key() -> Tuple[str, str]:
    """Generates a fresh secp256k1 keypair for register_identity(). Returns
    (private_key, address); store the private key securely - Scout never sees it."""
    Account, _ = _require_eth_account()
    acct = Account.create()
    return _as_0x(acct.key.hex()), acct.address


class ScoutApiError(Exception):
    def __init__(self, message: str, status: int = 0, body: Optional[Any] = None, code: str = "error"):
        super().__init__(message)
        self.status = status
        self.body = body
        self.code = code


class Scout:
    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        agent_name: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
        identity_private_key: Optional[str] = None,
    ):
        if not api_key:
            raise ValueError("Scout: api_key is required")

        self.api_key = api_key
        self.base_url = (base_url or os.environ.get("SCOUT_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.agent_name = agent_name
        self.timeout = timeout
        self.identity_private_key = identity_private_key
        self._session = requests.Session()

    # ------------------------------------------------------------------
    # Blockchain agent identity (ScoutAgentIdentity.sol, Sepolia - see scout-chain/)
    # ------------------------------------------------------------------

    def get_identity_challenge(self, agent_id: str) -> Dict[str, Any]:
        """One-time nonce the agent must sign to prove it controls the address it's about to claim."""
        return self._request("GET", f"/v1/agents/{agent_id}/identity/challenge")

    def register_identity(
        self,
        agent_id: str,
        private_key: Optional[str] = None,
        metadata_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Proves control of a key and anchors agent_id <-> address in Scout's
        on-chain identity registry. Uses `private_key` if given, else
        self.identity_private_key, else generates a fresh one - in which case
        save the returned private_key_used yourself; Scout never stores it."""
        Account, encode_defunct = _require_eth_account()
        key = private_key or self.identity_private_key or generate_identity_key()[0]
        acct = Account.from_key(key)

        challenge = self.get_identity_challenge(agent_id)
        signature = Account.sign_message(encode_defunct(text=challenge["message"]), private_key=key)

        result = self._request(
            "POST",
            f"/v1/agents/{agent_id}/identity/register",
            {
                "address": acct.address,
                "nonce": challenge["nonce"],
                "signature": _as_0x(signature.signature.hex()),
                "metadata_uri": metadata_uri,
            },
        )
        result["private_key_used"] = _as_0x(key) if isinstance(key, str) else key
        return result

    def _sign_envelope(
        self, agent_id: str, fields: Dict[str, Any], private_key: Optional[str] = None
    ) -> Optional[Dict[str, str]]:
        """Signs a canonical envelope the way scout-engine's strict-mode
        (organizations.require_onchain_identity) verifier expects: a JSON
        string containing agent_id + timestamp + domain fields, signed as a
        whole so key order can't be gamed."""
        key = private_key or self.identity_private_key
        if not key:
            return None
        Account, encode_defunct = _require_eth_account()
        envelope = {"agent_id": agent_id, "timestamp": int(time.time() * 1000), **fields}
        signed_message = json.dumps(envelope, separators=(",", ":"))
        signature = Account.sign_message(encode_defunct(text=signed_message), private_key=key)
        sig_hex = signature.signature.hex()
        return {"signed_message": signed_message, "signature": _as_0x(sig_hex)}

    def register_agent(
        self,
        name: str,
        agent_type: Optional[str] = None,
        tools: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload = {"name": name, "type": agent_type, "tools": tools, "metadata": metadata}
        return self._request("POST", "/v1/agents/register", payload)

    def filter(
        self,
        prompt: str,
        agent_id: str,
        tools: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        sign_with: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not agent_id:
            raise ValueError("Scout.filter: agent_id is required")
        envelope = self._sign_envelope(agent_id, {"prompt": prompt}, sign_with) or {}
        payload = {
            "prompt": prompt,
            "agent_id": agent_id,
            "tools": tools,
            "metadata": metadata,
            **envelope,
        }
        result = self._request("POST", "/v1/prompts/filter", payload)
        result["blocked"] = result.get("verdict") == "blocked"
        return result

    def track_event(
        self,
        agent_id: str,
        event_type: str,
        tool_name: Optional[str] = None,
        tool_args: Optional[Any] = None,
        tool_result: Optional[Any] = None,
        duration_ms: Optional[int] = None,
        session_id: Optional[str] = None,
        sign_with: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Signed as a single-event submission (event_count: 1) - matches how
        # scout-engine's /v1/events wraps one posted object into a
        # 1-element batch before checking the signature envelope.
        envelope = self._sign_envelope(agent_id, {"event_count": 1}, sign_with) or {}
        payload = {
            "agent_id": agent_id,
            "event_type": event_type,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "tool_result": tool_result,
            "duration_ms": duration_ms,
            "session_id": session_id,
            **envelope,
        }
        return self._request("POST", "/v1/events", payload)

    def get_status(self, agent_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/v1/agents/{agent_id}/status")

    def assert_agent_runnable(self, agent_id: str) -> Dict[str, Any]:
        status = self.get_status(agent_id)
        if status.get("kill_switch_active") or status.get("status") in ("suspended", "killed"):
            scope = status.get("kill_switch_scope")
            is_global = scope == "global"
            raise ScoutApiError(
                (
                    "Organization-wide kill switch is active. All agents are blocked until an operator resumes it."
                    if is_global
                    else "Agent is suspended. Tool and prompt processing are blocked until an operator resumes it."
                ),
                403,
                {
                    "error": "global_kill_switch" if is_global else "kill_switch",
                    "agent_id": agent_id,
                    "status": status.get("status"),
                    "kill_switch_active": True,
                    "scope": scope,
                    "reason": status.get("suspension_reason"),
                },
                code="global_kill_switch" if is_global else "kill_switch",
            )
        return status

    def health(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/health", auth=False)

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        auth: bool = True,
    ) -> Dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {self.api_key}"

        clean_payload = (
            {k: v for k, v in payload.items() if v is not None} if payload else None
        )

        try:
            response = self._session.request(
                method,
                f"{self.base_url}{path}",
                json=clean_payload,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ScoutApiError(f"Scout API request failed: {exc}") from exc

        data: Optional[Any]
        try:
            data = response.json() if response.content else None
        except ValueError:
            data = None

        if not response.ok:
            message = None
            code = "error"
            if isinstance(data, dict):
                message = data.get("message") or data.get("error")
                code = str(data.get("error") or "error")
            raise ScoutApiError(
                message or f"Scout API request failed with status {response.status_code}",
                response.status_code,
                data,
                code=code,
            )

        return data or {}
