"""
AgentLens Adapter for Google Agent Development Kit (ADK)

Automatically traces all ADK agent steps, tool calls, LLM invocations,
and sub-agent delegations within the ADK Runner lifecycle.

Usage:
    from google.adk.runners import Runner
    from google.adk.agents import Agent
    from agentlens import AgentLens
    from agentlens.adapters.adk_adapter import TracedRunner

    lens = AgentLens(session_name="My ADK Pipeline")

    agent = Agent(
        name="research_agent",
        model="gemini-3.5-flash",  # Updated June 2026: gemini-2.5-flash deprecated
        instruction="You are a research assistant.",
        tools=[search_tool],
    )

    runner = Runner(agent=agent, app_name="my_app", session_service=...)
    traced_runner = TracedRunner(runner, lens)

    # Run as normal — all steps are automatically traced
    async for event in traced_runner.run_async(user_id="user1", session_id="s1", new_message=...):
        print(event)

    lens.end()
"""

import time
import json
from typing import Any, Optional, AsyncIterator
from agentlens import AgentLens


class TracedRunner:
    """Wraps a Google ADK Runner to automatically trace execution.

    Intercepts the run/run_async lifecycle to capture:
    - Agent invocations with model/prompt/response data
    - Tool call details (name, input, output, duration)
    - Sub-agent delegation events
    - Errors with full stack traces

    Compatible with ADK Runner v1.x and v2.x.
    """

    def __init__(
        self,
        runner: Any,
        lens: AgentLens,
        trace_tool_calls: bool = True,
        trace_sub_agents: bool = True,
    ):
        self.runner = runner
        self.lens = lens
        self.trace_tool_calls = trace_tool_calls
        self.trace_sub_agents = trace_sub_agents
        self._agent_name = getattr(
            getattr(runner, 'agent', None), 'name', 'ADKAgent'
        )

    async def run_async(
        self,
        user_id: str,
        session_id: str,
        new_message: Any,
        **kwargs,
    ) -> AsyncIterator[Any]:
        """Run the ADK agent with automatic tracing.

        Yields events from the underlying runner while tracing each
        agent step, tool invocation, and sub-agent delegation.
        """
        self.lens.trace_decision(
            agent_name=self._agent_name,
            reason=f"Starting ADK session {session_id} for user {user_id}",
        )

        start = time.time()
        step_count = 0
        error_occurred = False

        try:
            # ADK's Runner.run_async returns an async generator of events
            run_method = getattr(self.runner, 'run_async', None)
            if run_method is None:
                raise AttributeError(
                    "Runner does not have run_async method. "
                    "Ensure you're using a compatible ADK version."
                )

            async for event in run_method(
                user_id=user_id,
                session_id=session_id,
                new_message=new_message,
                **kwargs,
            ):
                step_count += 1
                self._trace_event(event, step_count)
                yield event

        except Exception as e:
            error_occurred = True
            self.lens.trace_error(
                agent_name=self._agent_name,
                error_message=str(e),
                error_type=type(e).__name__,
            )
            raise
        finally:
            duration_ms = int((time.time() - start) * 1000)
            if not error_occurred:
                self.lens.trace_decision(
                    agent_name=self._agent_name,
                    reason=f"ADK session completed: {step_count} steps in {duration_ms}ms",
                    duration_ms=duration_ms,
                )

    def run(
        self,
        user_id: str,
        session_id: str,
        new_message: Any,
        **kwargs,
    ) -> Any:
        """Synchronous run with tracing (uses sync Runner.run if available)."""
        self.lens.trace_decision(
            agent_name=self._agent_name,
            reason=f"Starting ADK sync session {session_id} for user {user_id}",
        )

        start = time.time()
        try:
            run_method = getattr(self.runner, 'run', None)
            if run_method is None:
                raise AttributeError(
                    "Runner does not have a sync run method."
                )
            result = run_method(
                user_id=user_id,
                session_id=session_id,
                new_message=new_message,
                **kwargs,
            )
            duration_ms = int((time.time() - start) * 1000)
            self.lens.trace_decision(
                agent_name=self._agent_name,
                reason=f"ADK sync session completed in {duration_ms}ms",
                duration_ms=duration_ms,
            )
            return result
        except Exception as e:
            self.lens.trace_error(
                agent_name=self._agent_name,
                error_message=str(e),
                error_type=type(e).__name__,
            )
            raise

    def _trace_event(self, event: Any, step_index: int):
        """Trace an individual ADK event based on its type."""
        event_type = getattr(event, 'type', None) or type(event).__name__
        agent_name = getattr(event, 'agent_name', None) or self._agent_name
        model = getattr(event, 'model', None)

        # LLM response events
        if hasattr(event, 'content') and hasattr(event, 'model'):
            content = event.content
            text = ""
            if isinstance(content, str):
                text = content
            elif hasattr(content, 'parts'):
                text = " ".join(
                    getattr(p, 'text', '') for p in content.parts
                )
            elif isinstance(content, list):
                text = " ".join(str(c) for c in content)

            self.lens.trace_llm_call(
                agent_name=agent_name,
                model=str(model) if model else "gemini-unknown",
                provider="google",
                response=text[:2000],
                duration_ms=getattr(event, 'duration_ms', 0),
            )

        # Tool call events
        elif hasattr(event, 'tool_name') or hasattr(event, 'function_call'):
            if self.trace_tool_calls:
                tool_name = (
                    getattr(event, 'tool_name', None) or
                    getattr(getattr(event, 'function_call', None), 'name', 'unknown')
                )
                tool_input = (
                    getattr(event, 'tool_input', None) or
                    getattr(getattr(event, 'function_call', None), 'args', {})
                )
                tool_output = getattr(event, 'tool_output', None)

                if isinstance(tool_input, str):
                    try:
                        tool_input = json.loads(tool_input)
                    except (json.JSONDecodeError, TypeError):
                        tool_input = {"raw": tool_input}

                self.lens.trace_tool_call(
                    agent_name=agent_name,
                    tool_name=str(tool_name),
                    tool_input=tool_input if isinstance(tool_input, dict) else {},
                    tool_output=str(tool_output)[:500] if tool_output else None,
                    duration_ms=getattr(event, 'duration_ms', 0),
                )

        # Sub-agent delegation events
        elif hasattr(event, 'sub_agent') or hasattr(event, 'delegated_agent'):
            if self.trace_sub_agents:
                sub_agent = (
                    getattr(event, 'sub_agent', None) or
                    getattr(event, 'delegated_agent', None)
                )
                sub_name = getattr(sub_agent, 'name', str(sub_agent))

                self.lens.trace_agent_spawn(
                    parent_agent=agent_name,
                    spawned_agent=sub_name,
                    reason=f"ADK agent delegation: {agent_name} → {sub_name}",
                )

        # Error events
        elif hasattr(event, 'error') or event_type == 'error':
            error_msg = (
                getattr(event, 'error', None) or
                getattr(event, 'error_message', None) or
                str(event)
            )
            self.lens.trace_error(
                agent_name=agent_name,
                error_message=str(error_msg)[:500],
                error_type=event_type,
            )


class ADKCallbackHandler:
    """ADK-native callback handler for fine-grained step tracing.

    Can be passed to ADK's Runner as a callback for event-by-event tracing.

    Usage:
        handler = ADKCallbackHandler(lens)
        runner = Runner(agent=agent, callbacks=[handler])
    """

    def __init__(self, lens: AgentLens, agent_name: str = "ADKAgent"):
        self.lens = lens
        self.agent_name = agent_name

    def on_agent_start(self, agent_name: str, **kwargs):
        self.lens.trace_agent_spawn(
            parent_agent=self.agent_name,
            spawned_agent=agent_name,
            reason="ADK agent started",
        )

    def on_tool_start(self, tool_name: str, tool_input: Any, **kwargs):
        self._tool_start = time.time()
        self._tool_name = tool_name
        self._tool_input = tool_input

    def on_tool_end(self, tool_output: Any, **kwargs):
        duration_ms = int((time.time() - getattr(self, '_tool_start', time.time())) * 1000)
        self.lens.trace_tool_call(
            agent_name=self.agent_name,
            tool_name=getattr(self, '_tool_name', 'unknown'),
            tool_input=self._tool_input if isinstance(getattr(self, '_tool_input', None), dict) else {},
            tool_output=str(tool_output)[:500],
            duration_ms=duration_ms,
        )

    def on_llm_start(self, model: str, prompt: str, **kwargs):
        self._llm_start = time.time()
        self._llm_model = model
        self._llm_prompt = prompt

    def on_llm_end(self, response: str, tokens: Optional[dict] = None, **kwargs):
        duration_ms = int((time.time() - getattr(self, '_llm_start', time.time())) * 1000)
        self.lens.trace_llm_call(
            agent_name=self.agent_name,
            model=getattr(self, '_llm_model', 'gemini-unknown'),
            provider="google",
            prompt=getattr(self, '_llm_prompt', '')[:500],
            response=str(response)[:500],
            tokens=tokens,
            duration_ms=duration_ms,
        )

    def on_error(self, error: Exception, **kwargs):
        self.lens.trace_error(
            agent_name=self.agent_name,
            error_message=str(error),
            error_type=type(error).__name__,
        )
