"""
AgentLens Adapter for AutoGen (Microsoft)

Automatically traces all AutoGen agent conversations, tool calls,
and multi-agent interactions.

Usage:
    import autogen
    from agentlens import AgentLens
    from agentlens.adapters.autogen_adapter import TracedAgent, trace_groupchat

    lens = AgentLens(session_name="My AutoGen Pipeline")

    assistant = TracedAgent(
        autogen.AssistantAgent("assistant", llm_config=...),
        lens=lens,
    )
    user_proxy = TracedAgent(
        autogen.UserProxyAgent("user_proxy", ...),
        lens=lens,
    )

    user_proxy.agent.initiate_chat(assistant.agent, message="Hello")
    lens.end()
"""

import time
import json
from typing import Any, Optional, Callable
from agentlens import AgentLens


def _safe_parse_args(raw_args: Any) -> dict:
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        try:
            parsed = json.loads(raw_args)
            return parsed if isinstance(parsed, dict) else {"raw": raw_args}
        except (json.JSONDecodeError, TypeError):
            return {"raw": raw_args}
    return {}


class TracedAgent:
    """Wraps an AutoGen agent to trace all message sends and receives."""

    def __init__(self, agent: Any, lens: AgentLens):
        self.agent = agent
        self.lens = lens
        self._patch_agent()

    def _patch_agent(self):
        """Monkey-patch the agent's send/receive methods."""
        original_generate = getattr(self.agent, 'generate_reply', None)
        if original_generate:
            self.agent.generate_reply = self._make_traced_generate(original_generate)

        # Register reply function hook
        if hasattr(self.agent, 'register_hook'):
            self.agent.register_hook('process_message_before_send', self._on_message_send)

    def _make_traced_generate(self, original_fn: Callable):
        lens = self.lens
        agent = self.agent

        def traced_generate(messages=None, sender=None, **kwargs):
            agent_name = getattr(agent, 'name', 'Agent')
            start = time.time()

            try:
                result = original_fn(messages=messages, sender=sender, **kwargs)
                duration_ms = int((time.time() - start) * 1000)

                # Extract the last user message as prompt
                prompt = ""
                if messages:
                    for msg in reversed(messages):
                        if msg.get('role') == 'user' or msg.get('name') != agent_name:
                            prompt = str(msg.get('content', ''))[:500]
                            break

                response_text = str(result)[:500] if result else ""

                # Detect if this is a tool call response
                if isinstance(result, dict) and 'tool_calls' in result:
                    for tool_call in result['tool_calls']:
                        fn_info = tool_call.get('function', {}) if isinstance(tool_call, dict) else {}
                        lens.trace_tool_call(
                            agent_name=agent_name,
                            tool_name=fn_info.get('name', 'unknown'),
                            tool_input=_safe_parse_args(fn_info.get('arguments', {})),
                            duration_ms=duration_ms,
                        )
                else:
                    lens.trace_llm_call(
                        agent_name=agent_name,
                        model=_get_model_name(agent),
                        provider="autogen",
                        prompt=prompt,
                        response=response_text,
                        duration_ms=duration_ms,
                    )

                return result
            except Exception as e:
                lens.trace_error(
                    agent_name=agent_name,
                    error_message=str(e),
                    error_type=type(e).__name__,
                )
                raise

        return traced_generate

    def _on_message_send(self, sender: Any, message: Any, recipient: Any, silent: bool):
        """Hook called before sending a message."""
        sender_name = getattr(sender, 'name', 'Unknown')
        recipient_name = getattr(recipient, 'name', 'Unknown')
        msg_content = str(message)[:200] if message else ""

        self.lens.trace_decision(
            agent_name=sender_name,
            reason=f"Sending message to {recipient_name}: {msg_content}",
        )
        return message


def trace_groupchat(groupchat: Any, lens: AgentLens) -> Any:
    """
    Trace an AutoGen GroupChat.

    Usage:
        from autogen import GroupChat, GroupChatManager
        groupchat = GroupChat(agents=[...], messages=[], max_round=10)
        traced_gc = trace_groupchat(groupchat, lens)
    """
    # Wrap all agents in the group
    if hasattr(groupchat, 'agents'):
        for i, agent in enumerate(groupchat.agents):
            traced = TracedAgent(agent, lens)
            # Agent is patched in-place

        lens.trace_decision(
            agent_name="GroupChat",
            reason=f"Group chat initialized with {len(groupchat.agents)} agents: "
                   f"{', '.join(getattr(a, 'name', 'unknown') for a in groupchat.agents)}",
        )

    return groupchat


def _get_model_name(agent: Any) -> str:
    """Extract model name from an AutoGen agent's config."""
    llm_config = getattr(agent, 'llm_config', {})
    if isinstance(llm_config, dict):
        config_list = llm_config.get('config_list', [])
        if config_list and isinstance(config_list[0], dict):
            return config_list[0].get('model', 'unknown')
    return 'unknown'
