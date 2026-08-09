"""Minimal Python client for the Scout runtime security API."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests

DEFAULT_BASE_URL = "https://console.labyrinthscout.com"
DEFAULT_TIMEOUT_SECONDS = 10


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
    ):
        if not api_key:
            raise ValueError("Scout: api_key is required")

        self.api_key = api_key
        self.base_url = (base_url or os.environ.get("SCOUT_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.agent_name = agent_name
        self.timeout = timeout
        self._session = requests.Session()

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
    ) -> Dict[str, Any]:
        if not agent_id:
            raise ValueError("Scout.filter: agent_id is required")
        payload = {
            "prompt": prompt,
            "agent_id": agent_id,
            "tools": tools,
            "metadata": metadata,
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
    ) -> Dict[str, Any]:
        payload = {
            "agent_id": agent_id,
            "event_type": event_type,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "tool_result": tool_result,
            "duration_ms": duration_ms,
            "session_id": session_id,
        }
        return self._request("POST", "/v1/events", payload)

    def get_status(self, agent_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/v1/agents/{agent_id}/status")

    def assert_agent_runnable(self, agent_id: str) -> Dict[str, Any]:
        status = self.get_status(agent_id)
        if status.get("kill_switch_active") or status.get("status") in ("suspended", "killed"):
            raise ScoutApiError(
                "Agent is suspended. Tool and prompt processing are blocked until an operator resumes it.",
                403,
                {
                    "error": "kill_switch",
                    "agent_id": agent_id,
                    "status": status.get("status"),
                    "kill_switch_active": True,
                },
                code="kill_switch",
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
