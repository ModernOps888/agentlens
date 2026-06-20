"""
AgentLens Python SDK — Trace your AI agents in 2 lines of code.

Supports: OpenAI, Anthropic (Claude), Google (Gemini), Ollama, LiteLLM,
and any custom provider via manual tracing.

Usage:
    from agentlens import AgentLens

    # Initialize (starts a trace session)
    lens = AgentLens(session_name="My Agent Pipeline")

    # Option 1: Wrap your OpenAI client (automatic capture)
    client = lens.wrap_openai(OpenAI())
    response = client.chat.completions.create(...)  # Automatically traced!

    # Option 2: Wrap your Anthropic client (automatic capture)
    client = lens.wrap_anthropic(Anthropic())
    response = client.messages.create(...)  # Automatically traced!

    # Option 3: Wrap your Google Gemini client (automatic capture)
    model = lens.wrap_google(genai.GenerativeModel("gemini-3.5-flash"))  # Updated June 2026
    response = model.generate_content(...)  # Automatically traced!

    # Option 4: Wrap Ollama (automatic capture)
    ollama = lens.wrap_ollama()
    response = ollama.chat(model="llama3", messages=[...])  # Traced!

    # Option 5: Manual tracing (any provider)
    lens.trace_llm_call(
        agent_name="Researcher",
        model="gpt-5.4",  # Updated June 2026: gpt-4o deprecated
        prompt="Research this topic...",
        response="Here are the findings...",
        tokens={"prompt_tokens": 150, "completion_tokens": 200, "total_tokens": 350},
    )

    # Option 6: Trace tool/MCP calls
    lens.trace_tool_call(
        agent_name="CodeAgent",
        tool_name="file_read",
        tool_input={"path": "/src/main.py"},
        tool_output="file contents...",
    )

    # End the session
    lens.end()
"""

import time
import uuid
import json
import logging
from typing import Any, Callable, Optional, Dict, List
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    requests = None  # type: ignore

# Optional async support — users don't need aiohttp unless they use async methods
try:
    import aiohttp

    _HAS_AIOHTTP = True
except ImportError:
    _HAS_AIOHTTP = False

logger = logging.getLogger("agentlens")

AGENTLENS_DEFAULT_URL = "http://localhost:3000"


class AgentLens:
    """Lightweight trace client for AgentLens.

    Thread-safe and re-entrant. Each instance represents one trace session.
    All network calls are fire-and-forget with a 5s timeout — they never
    block your agent's critical path.
    """

    def __init__(
        self,
        session_name: str = "Untitled Session",
        server_url: str = AGENTLENS_DEFAULT_URL,
        session_id: Optional[str] = None,
        auto_end: bool = True,
        tags: Optional[List[str]] = None,
    ):
        if requests is None:
            raise ImportError(
                "The 'requests' package is required. Install it: pip install requests"
            )

        self.server_url = server_url.rstrip("/")
        self.session_id = session_id or str(uuid.uuid4())
        self.session_name = session_name
        self.auto_end = auto_end
        self.tags = tags or []
        self._step_count = 0

        logger.info(f"AgentLens session started: {self.session_id}")

    # ─── Core Transport ──────────────────────────────────────────────────

    def _send(self, data: dict, action: Optional[str] = None) -> dict:
        """Send data to the AgentLens ingest API (sync, fire-and-forget)."""
        url = f"{self.server_url}/api/ingest"
        if action:
            url += f"?action={action}"
        try:
            resp = requests.post(url, json=data, timeout=5)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"AgentLens send failed: {e}")
            return {"ok": False, "error": str(e)}

    async def _send_async(self, data: dict, action: Optional[str] = None) -> dict:
        """Send data to the AgentLens ingest API (async, fire-and-forget).

        Falls back to sync _send() if aiohttp is not installed.
        """
        if not _HAS_AIOHTTP:
            return self._send(data, action)

        url = f"{self.server_url}/api/ingest"
        if action:
            url += f"?action={action}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=data, timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    return await resp.json()
        except Exception as e:
            logger.warning(f"AgentLens async send failed: {e}")
            return {"ok": False, "error": str(e)}

    # ─── Trace Methods (Sync) ────────────────────────────────────────────

    def trace_llm_call(
        self,
        agent_name: str,
        model: str = "unknown",
        prompt: str = "",
        system_prompt: str = "",
        response: str = "",
        provider: str = "openai",
        temperature: Optional[float] = None,
        tokens: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: str = "success",
    ) -> dict:
        """Trace an LLM API call."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": agent_name,
            "step_type": "llm_call",
            "status": status,
            "provider": provider,
            "model": model,
            "prompt": prompt,
            "system_prompt": system_prompt,
            "response": response,
            "temperature": temperature,
            "tokens": tokens,
            "duration_ms": duration_ms or 0,
        })

    def trace_tool_call(
        self,
        agent_name: str,
        tool_name: str,
        tool_input: Optional[dict] = None,
        tool_output: Any = None,
        duration_ms: Optional[int] = None,
        status: str = "success",
    ) -> dict:
        """Trace a tool invocation."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": agent_name,
            "step_type": "tool_call",
            "status": status,
            "tool_name": tool_name,
            "tool_input": tool_input or {},
            "tool_output": tool_output,
            "duration_ms": duration_ms or 0,
        })

    def trace_mcp_call(
        self,
        agent_name: str,
        server_name: str,
        tool_name: str,
        params: Optional[dict] = None,
        result: Any = None,
        duration_ms: Optional[int] = None,
        status: str = "success",
    ) -> dict:
        """Trace an MCP tool invocation."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": agent_name,
            "step_type": "mcp_invoke",
            "status": status,
            "mcp_server": server_name,
            "mcp_tool": tool_name,
            "mcp_params": params or {},
            "mcp_result": result,
            "duration_ms": duration_ms or 0,
        })

    def trace_agent_spawn(
        self,
        parent_agent: str,
        spawned_agent: str,
        reason: str = "",
    ) -> dict:
        """Trace spawning a sub-agent."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": parent_agent,
            "step_type": "agent_spawn",
            "spawned_agent": spawned_agent,
            "decision_reason": reason,
            "duration_ms": 0,
        })

    def trace_decision(
        self,
        agent_name: str,
        reason: str,
        duration_ms: Optional[int] = None,
    ) -> dict:
        """Trace a decision point."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": agent_name,
            "step_type": "decision",
            "decision_reason": reason,
            "duration_ms": duration_ms or 0,
        })

    def trace_error(
        self,
        agent_name: str,
        error_message: str,
        error_type: str = "Error",
    ) -> dict:
        """Trace an error."""
        return self._send({
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": agent_name,
            "step_type": "error",
            "status": "error",
            "error_message": error_message,
            "error_type": error_type,
            "duration_ms": 0,
        })

    def end(self, status: str = "completed") -> dict:
        """End the trace session."""
        result = self._send(
            {"session_id": self.session_id, "status": status},
            action="end",
        )
        logger.info(f"AgentLens session ended: {self.session_id}")
        return result

    # ─── Async Trace Methods ─────────────────────────────────────────────

    async def trace_llm_call_async(self, **kwargs) -> dict:
        """Async version of trace_llm_call(). Uses aiohttp if available."""
        data = {
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": kwargs.get("agent_name", "Agent"),
            "step_type": "llm_call",
            "status": kwargs.get("status", "success"),
            "provider": kwargs.get("provider", "openai"),
            "model": kwargs.get("model", "unknown"),
            "prompt": kwargs.get("prompt", ""),
            "system_prompt": kwargs.get("system_prompt", ""),
            "response": kwargs.get("response", ""),
            "temperature": kwargs.get("temperature"),
            "tokens": kwargs.get("tokens"),
            "duration_ms": kwargs.get("duration_ms", 0),
        }
        return await self._send_async(data)

    async def trace_tool_call_async(self, **kwargs) -> dict:
        """Async version of trace_tool_call()."""
        data = {
            "session_id": self.session_id,
            "session_name": self.session_name,
            "agent_name": kwargs.get("agent_name", "Agent"),
            "step_type": "tool_call",
            "status": kwargs.get("status", "success"),
            "tool_name": kwargs.get("tool_name", "unknown"),
            "tool_input": kwargs.get("tool_input", {}),
            "tool_output": kwargs.get("tool_output"),
            "duration_ms": kwargs.get("duration_ms", 0),
        }
        return await self._send_async(data)

    async def end_async(self, status: str = "completed") -> dict:
        """Async version of end()."""
        return await self._send_async(
            {"session_id": self.session_id, "status": status},
            action="end",
        )

    # ─── OpenAI Client Wrapper ───────────────────────────────────────────

    def wrap_openai(self, client: Any, agent_name: str = "Agent") -> Any:
        """
        Wrap an OpenAI client to automatically trace all chat completions.

        Usage:
            from openai import OpenAI
            client = lens.wrap_openai(OpenAI(), agent_name="MyAgent")
            response = client.chat.completions.create(model="gpt-5.4",  # Updated June 2026: gpt-4o deprecated messages=[...])
            # ^ This call is automatically traced in AgentLens!
        """
        lens = self
        original_create = client.chat.completions.create

        def traced_create(*args, **kwargs):
            start = time.time()
            try:
                response = original_create(*args, **kwargs)
                duration_ms = int((time.time() - start) * 1000)

                # Extract data from the response
                model = kwargs.get("model", getattr(response, "model", "unknown"))
                messages = kwargs.get("messages", [])
                system_prompt = ""
                user_prompt = ""
                for msg in messages:
                    if msg.get("role") == "system":
                        system_prompt = msg.get("content", "")
                    elif msg.get("role") == "user":
                        user_prompt = msg.get("content", "")

                response_text = ""
                if hasattr(response, "choices") and response.choices:
                    response_text = response.choices[0].message.content or ""

                tokens = None
                if hasattr(response, "usage") and response.usage:
                    tokens = {
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                        "total_tokens": response.usage.total_tokens,
                    }

                lens.trace_llm_call(
                    agent_name=agent_name,
                    model=model,
                    prompt=user_prompt,
                    system_prompt=system_prompt,
                    response=response_text,
                    provider="openai",
                    temperature=kwargs.get("temperature"),
                    tokens=tokens,
                    duration_ms=duration_ms,
                )
                return response

            except Exception as e:
                duration_ms = int((time.time() - start) * 1000)
                lens.trace_error(agent_name=agent_name, error_message=str(e))
                raise

        client.chat.completions.create = traced_create
        return client

    # ─── Anthropic (Claude) Client Wrapper ───────────────────────────────

    def wrap_anthropic(self, client: Any, agent_name: str = "Agent") -> Any:
        """
        Wrap an Anthropic client to automatically trace all message creations.

        Usage:
            from anthropic import Anthropic
            client = lens.wrap_anthropic(Anthropic(), agent_name="ClaudeAgent")
            response = client.messages.create(
                model="claude-sonnet-4-6",  # Updated June 2026: model deprecated
                max_tokens=1024,
                messages=[{"role": "user", "content": "Hello Claude"}]
            )
            # ^ This call is automatically traced in AgentLens!

        Also works with the async client:
            from anthropic import AsyncAnthropic
            client = lens.wrap_anthropic(AsyncAnthropic(), agent_name="AsyncClaude")
        """
        lens = self

        # Detect sync vs async client
        original_create = client.messages.create
        is_async = _is_coroutine_function(original_create)

        if is_async:
            async def traced_create_async(*args, **kwargs):
                start = time.time()
                try:
                    response = await original_create(*args, **kwargs)
                    duration_ms = int((time.time() - start) * 1000)
                    lens._trace_anthropic_response(
                        response, kwargs, agent_name, duration_ms
                    )
                    return response
                except Exception as e:
                    lens.trace_error(agent_name=agent_name, error_message=str(e))
                    raise

            client.messages.create = traced_create_async
        else:
            def traced_create(*args, **kwargs):
                start = time.time()
                try:
                    response = original_create(*args, **kwargs)
                    duration_ms = int((time.time() - start) * 1000)
                    lens._trace_anthropic_response(
                        response, kwargs, agent_name, duration_ms
                    )
                    return response
                except Exception as e:
                    lens.trace_error(agent_name=agent_name, error_message=str(e))
                    raise

            client.messages.create = traced_create

        return client

    def _trace_anthropic_response(
        self, response: Any, kwargs: dict, agent_name: str, duration_ms: int
    ):
        """Extract trace data from an Anthropic Messages API response."""
        model = kwargs.get("model", getattr(response, "model", "unknown"))

        # Extract messages
        messages = kwargs.get("messages", [])
        system_prompt = kwargs.get("system", "")
        # System can be a string or list of content blocks
        if isinstance(system_prompt, list):
            system_prompt = " ".join(
                b.get("text", "") if isinstance(b, dict) else str(b)
                for b in system_prompt
            )

        user_prompt = ""
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Content blocks (text, image, etc.)
                    user_prompt = " ".join(
                        b.get("text", "") if isinstance(b, dict) else str(b)
                        for b in content
                    )
                else:
                    user_prompt = str(content)

        # Extract response text
        response_text = ""
        if hasattr(response, "content") and response.content:
            text_blocks = []
            for block in response.content:
                if hasattr(block, "text"):
                    text_blocks.append(block.text)
                elif hasattr(block, "type") and block.type == "tool_use":
                    text_blocks.append(
                        f"[tool_use: {getattr(block, 'name', 'unknown')}]"
                    )
            response_text = "\n".join(text_blocks)

        # Extract token usage
        tokens = None
        if hasattr(response, "usage") and response.usage:
            input_tokens = getattr(response.usage, "input_tokens", 0)
            output_tokens = getattr(response.usage, "output_tokens", 0)
            # Include cache tokens if present (Claude extended thinking)
            cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
            cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            tokens = {
                "prompt_tokens": input_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }

        # Detect tool use in response
        tool_calls = []
        if hasattr(response, "content"):
            for block in response.content:
                if hasattr(block, "type") and block.type == "tool_use":
                    tool_calls.append({
                        "name": getattr(block, "name", "unknown"),
                        "input": getattr(block, "input", {}),
                    })

        self.trace_llm_call(
            agent_name=agent_name,
            model=model,
            prompt=user_prompt,
            system_prompt=str(system_prompt),
            response=response_text,
            provider="anthropic",
            temperature=kwargs.get("temperature"),
            tokens=tokens,
            duration_ms=duration_ms,
        )

        # Also trace individual tool calls if Claude invoked tools
        for tc in tool_calls:
            self.trace_tool_call(
                agent_name=agent_name,
                tool_name=tc["name"],
                tool_input=tc["input"],
                duration_ms=0,
            )

    # ─── Google Gemini Client Wrapper ────────────────────────────────────

    def wrap_google(self, model: Any, agent_name: str = "Agent") -> Any:
        """
        Wrap a Google GenerativeModel to trace all generate_content calls.

        Usage:
            import google.generativeai as genai
            genai.configure(api_key="...")
            model = genai.GenerativeModel("gemini-3.5-flash")  # Updated June 2026
            model = lens.wrap_google(model, agent_name="GeminiAgent")
            response = model.generate_content("Explain quantum computing")
            # ^ Automatically traced!

        Works with both sync and async generate_content.
        """
        lens = self
        original_generate = model.generate_content

        is_async = _is_coroutine_function(original_generate)

        if is_async:
            async def traced_generate_async(*args, **kwargs):
                start = time.time()
                try:
                    response = await original_generate(*args, **kwargs)
                    duration_ms = int((time.time() - start) * 1000)
                    lens._trace_google_response(
                        response, args, kwargs, model, agent_name, duration_ms
                    )
                    return response
                except Exception as e:
                    lens.trace_error(agent_name=agent_name, error_message=str(e))
                    raise

            model.generate_content = traced_generate_async
        else:
            def traced_generate(*args, **kwargs):
                start = time.time()
                try:
                    response = original_generate(*args, **kwargs)
                    duration_ms = int((time.time() - start) * 1000)
                    lens._trace_google_response(
                        response, args, kwargs, model, agent_name, duration_ms
                    )
                    return response
                except Exception as e:
                    lens.trace_error(agent_name=agent_name, error_message=str(e))
                    raise

            model.generate_content = traced_generate

        return model

    def _trace_google_response(
        self, response: Any, args: tuple, kwargs: dict,
        model: Any, agent_name: str, duration_ms: int
    ):
        """Extract trace data from a Google Gemini response."""
        model_name = getattr(model, "model_name", "gemini-unknown")
        if model_name.startswith("models/"):
            model_name = model_name[7:]

        # Extract prompt
        prompt = ""
        if args:
            content = args[0]
            if isinstance(content, str):
                prompt = content
            elif isinstance(content, list):
                prompt = " ".join(str(c) for c in content)
            else:
                prompt = str(content)[:500]

        # Extract response text
        response_text = ""
        try:
            if hasattr(response, "text"):
                response_text = response.text
            elif hasattr(response, "candidates") and response.candidates:
                parts = response.candidates[0].content.parts
                response_text = " ".join(
                    getattr(p, "text", "") for p in parts
                )
        except Exception:
            response_text = str(response)[:500]

        # Extract token usage
        tokens = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            prompt_tokens = getattr(um, "prompt_token_count", 0) or 0
            completion_tokens = getattr(um, "candidates_token_count", 0) or 0
            total_tokens = getattr(um, "total_token_count", 0) or (
                prompt_tokens + completion_tokens
            )
            tokens = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }

        self.trace_llm_call(
            agent_name=agent_name,
            model=model_name,
            prompt=prompt,
            response=response_text,
            provider="google",
            tokens=tokens,
            duration_ms=duration_ms,
        )

    # ─── Ollama Wrapper ──────────────────────────────────────────────────

    def wrap_ollama(
        self,
        base_url: str = "http://localhost:11434",
        agent_name: str = "Agent",
    ) -> "OllamaTraced":
        """
        Create a traced Ollama client that auto-traces all chat/generate calls.

        Usage:
            ollama = lens.wrap_ollama(agent_name="LocalLLM")
            response = ollama.chat(model="llama3", messages=[
                {"role": "user", "content": "Hello!"}
            ])
            # ^ Automatically traced!

            response = ollama.generate(model="codellama", prompt="Write a function")
            # ^ Also traced!

        Does NOT require the `ollama` Python package — uses raw HTTP.
        """
        return OllamaTraced(self, base_url, agent_name)

    # ─── LiteLLM Callback Integration ────────────────────────────────────

    def wrap_litellm(self, agent_name: str = "Agent") -> "LiteLLMCallback":
        """
        Create a LiteLLM callback that auto-traces every completion.

        Usage:
            import litellm
            callback = lens.wrap_litellm(agent_name="MultiModel")
            litellm.callbacks = [callback]

            # Now every litellm.completion() call is traced regardless of provider
            response = litellm.completion(model="gpt-5.4",  # Updated June 2026: gpt-4o deprecated messages=[...])
            response = litellm.completion(model="claude-sonnet-4-6",  # Updated June 2026 messages=[...])
            response = litellm.completion(model="ollama/llama3", messages=[...])
        """
        return LiteLLMCallback(self, agent_name)

    # ─── Context Manager ─────────────────────────────────────────────────

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        status = "failed" if exc_type else "completed"
        self.end(status=status)
        return False


# ═════════════════════════════════════════════════════════════════════════════
# Ollama Traced Client
# ═════════════════════════════════════════════════════════════════════════════


class OllamaTraced:
    """Lightweight Ollama HTTP client with automatic AgentLens tracing.

    Uses raw HTTP requests — does NOT depend on the `ollama` Python package.
    """

    def __init__(self, lens: AgentLens, base_url: str, agent_name: str):
        self._lens = lens
        self._base_url = base_url.rstrip("/")
        self._agent_name = agent_name

    def chat(
        self,
        model: str,
        messages: List[Dict[str, str]],
        **kwargs,
    ) -> dict:
        """Send a chat completion request to Ollama and trace it."""
        start = time.time()
        try:
            payload = {"model": model, "messages": messages, "stream": False, **kwargs}
            resp = requests.post(
                f"{self._base_url}/api/chat", json=payload, timeout=120
            )
            resp.raise_for_status()
            data = resp.json()
            duration_ms = int((time.time() - start) * 1000)

            # Extract data
            response_text = ""
            if "message" in data and "content" in data["message"]:
                response_text = data["message"]["content"]

            user_prompt = ""
            system_prompt = ""
            for msg in messages:
                if msg.get("role") == "user":
                    user_prompt = msg.get("content", "")
                elif msg.get("role") == "system":
                    system_prompt = msg.get("content", "")

            tokens = None
            if "prompt_eval_count" in data or "eval_count" in data:
                prompt_tokens = data.get("prompt_eval_count", 0)
                completion_tokens = data.get("eval_count", 0)
                tokens = {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                }

            self._lens.trace_llm_call(
                agent_name=self._agent_name,
                model=model,
                prompt=user_prompt,
                system_prompt=system_prompt,
                response=response_text,
                provider="ollama",
                tokens=tokens,
                duration_ms=duration_ms,
            )
            return data

        except Exception as e:
            self._lens.trace_error(
                agent_name=self._agent_name, error_message=str(e)
            )
            raise

    def generate(self, model: str, prompt: str, **kwargs) -> dict:
        """Send a generate request to Ollama and trace it."""
        start = time.time()
        try:
            payload = {"model": model, "prompt": prompt, "stream": False, **kwargs}
            resp = requests.post(
                f"{self._base_url}/api/generate", json=payload, timeout=120
            )
            resp.raise_for_status()
            data = resp.json()
            duration_ms = int((time.time() - start) * 1000)

            tokens = None
            if "prompt_eval_count" in data or "eval_count" in data:
                prompt_tokens = data.get("prompt_eval_count", 0)
                completion_tokens = data.get("eval_count", 0)
                tokens = {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                }

            self._lens.trace_llm_call(
                agent_name=self._agent_name,
                model=model,
                prompt=prompt,
                response=data.get("response", ""),
                provider="ollama",
                tokens=tokens,
                duration_ms=duration_ms,
            )
            return data

        except Exception as e:
            self._lens.trace_error(
                agent_name=self._agent_name, error_message=str(e)
            )
            raise


# ═════════════════════════════════════════════════════════════════════════════
# LiteLLM Callback
# ═════════════════════════════════════════════════════════════════════════════


class LiteLLMCallback:
    """LiteLLM custom callback that auto-traces every completion.

    Implements the LiteLLM CustomLogger interface. Works with every
    provider LiteLLM supports (OpenAI, Anthropic, Google, Azure, etc.)
    """

    def __init__(self, lens: AgentLens, agent_name: str):
        self._lens = lens
        self._agent_name = agent_name

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Called by LiteLLM after a successful completion."""
        duration_ms = int((end_time - start_time).total_seconds() * 1000)

        model = kwargs.get("model", "unknown")
        messages = kwargs.get("messages", [])

        user_prompt = ""
        system_prompt = ""
        for msg in messages:
            if isinstance(msg, dict):
                if msg.get("role") == "user":
                    user_prompt = str(msg.get("content", ""))
                elif msg.get("role") == "system":
                    system_prompt = str(msg.get("content", ""))

        response_text = ""
        tokens = None

        if hasattr(response_obj, "choices") and response_obj.choices:
            choice = response_obj.choices[0]
            if hasattr(choice, "message") and choice.message:
                response_text = getattr(choice.message, "content", "") or ""

        if hasattr(response_obj, "usage") and response_obj.usage:
            usage = response_obj.usage
            tokens = {
                "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
                "total_tokens": getattr(usage, "total_tokens", 0) or 0,
            }

        # Detect provider from model name
        provider = _detect_provider(model)

        self._lens.trace_llm_call(
            agent_name=self._agent_name,
            model=model,
            prompt=user_prompt,
            system_prompt=system_prompt,
            response=response_text,
            provider=provider,
            tokens=tokens,
            duration_ms=duration_ms,
        )

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Called by LiteLLM after a failed completion."""
        error_msg = str(response_obj) if response_obj else "Unknown error"
        self._lens.trace_error(
            agent_name=self._agent_name,
            error_message=error_msg,
            error_type="LiteLLMError",
        )


# ═════════════════════════════════════════════════════════════════════════════
# Utility Functions
# ═════════════════════════════════════════════════════════════════════════════


def _is_coroutine_function(fn: Any) -> bool:
    """Check if a function is an async coroutine function."""
    import inspect
    return inspect.iscoroutinefunction(fn)


def _detect_provider(model: str) -> str:
    """Detect the LLM provider from a model name string."""
    model_lower = model.lower()
    if "gpt" in model_lower or "o1" in model_lower or "o3" in model_lower:
        return "openai"
    if "claude" in model_lower:
        return "anthropic"
    if "gemini" in model_lower:
        return "google"
    if "llama" in model_lower or "mistral" in model_lower or "deepseek" in model_lower:
        return "ollama"
    if "/" in model_lower:
        # LiteLLM format like "ollama/llama3", "anthropic/claude-3"
        return model_lower.split("/")[0]
    return "unknown"
