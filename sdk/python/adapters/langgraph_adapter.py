"""
AgentLens Adapter for LangGraph

Automatically traces all LangGraph node executions, tool calls,
and state transitions.

Usage:
    from langgraph.graph import StateGraph
    from agentlens import AgentLens
    from agentlens.adapters.langgraph_adapter import TracedGraph

    lens = AgentLens(session_name="My LangGraph Pipeline")
    
    # Wrap your compiled graph
    graph = StateGraph(...)
    graph.add_node("research", research_node)
    graph.add_node("write", write_node)
    compiled = graph.compile()
    
    traced = TracedGraph(compiled, lens)
    result = traced.invoke({"input": "research AI trends"})
    
    lens.end()
"""

import time
import json
from typing import Any, Optional
from agentlens import AgentLens


class TracedGraph:
    """Wraps a compiled LangGraph to automatically trace execution."""

    def __init__(self, graph: Any, lens: AgentLens, graph_name: str = "LangGraph"):
        self.graph = graph
        self.lens = lens
        self.graph_name = graph_name
        self._patch_nodes()

    def _patch_nodes(self):
        """Wrap each node's function to trace execution."""
        if hasattr(self.graph, 'nodes'):
            for node_name, node_fn in self.graph.nodes.items():
                self.graph.nodes[node_name] = self._make_traced_node(node_name, node_fn)

    def _make_traced_node(self, name: str, fn: Any):
        lens = self.lens
        graph_name = self.graph_name

        def traced_fn(state: Any, *args, **kwargs):
            start = time.time()
            try:
                result = fn(state, *args, **kwargs)
                duration_ms = int((time.time() - start) * 1000)

                # Detect if this is an LLM call or tool call
                state_str = json.dumps(state, default=str)[:500] if state else ""
                result_str = json.dumps(result, default=str)[:500] if result else ""

                lens.trace_llm_call(
                    agent_name=f"{graph_name}/{name}",
                    model="langgraph-node",
                    provider="langgraph",
                    prompt=state_str,
                    response=result_str,
                    duration_ms=duration_ms,
                )
                return result
            except Exception as e:
                duration_ms = int((time.time() - start) * 1000)
                lens.trace_error(
                    agent_name=f"{graph_name}/{name}",
                    error_message=str(e),
                    error_type=type(e).__name__,
                )
                raise

        return traced_fn

    def invoke(self, *args, **kwargs):
        self.lens.trace_decision(
            agent_name=self.graph_name,
            reason=f"Starting graph execution with {len(getattr(self.graph, 'nodes', {}))} nodes",
        )
        result = self.graph.invoke(*args, **kwargs)
        return result

    async def ainvoke(self, *args, **kwargs):
        self.lens.trace_decision(
            agent_name=self.graph_name,
            reason=f"Starting async graph execution",
        )
        result = await self.graph.ainvoke(*args, **kwargs)
        return result


class LangGraphCallbackHandler:
    """
    LangGraph callback handler for automatic tracing.
    
    Usage:
        from langchain_core.callbacks import CallbackManager
        handler = LangGraphCallbackHandler(lens)
        # Pass to your chain/agent as a callback
    """

    def __init__(self, lens: AgentLens, agent_name: str = "LangGraph"):
        self.lens = lens
        self.agent_name = agent_name
        self._serialized: Optional[dict] = None

    def on_chain_start(self, serialized: dict, inputs: dict, **kwargs):
        self.lens.trace_decision(
            agent_name=self.agent_name,
            reason=f"Chain started: {serialized.get('name', 'unknown')}",
        )

    def on_chain_end(self, outputs: dict, **kwargs):
        pass

    def on_llm_start(self, serialized: dict, prompts: list, **kwargs):
        self._llm_start_time = time.time()
        self._llm_prompts = prompts
        self._serialized = serialized

    def on_llm_end(self, response: Any, **kwargs):
        duration_ms = int((time.time() - getattr(self, '_llm_start_time', time.time())) * 1000)
        prompts = getattr(self, '_llm_prompts', [])

        response_text = ""
        tokens = None
        if hasattr(response, 'generations') and response.generations:
            for gen in response.generations:
                if gen:
                    response_text = gen[0].text if gen[0] else ""

        if hasattr(response, 'llm_output') and response.llm_output:
            usage = response.llm_output.get('token_usage', {})
            if usage:
                tokens = {
                    "prompt_tokens": usage.get('prompt_tokens', 0),
                    "completion_tokens": usage.get('completion_tokens', 0),
                    "total_tokens": usage.get('total_tokens', 0),
                }

        serialized_dict = getattr(self, '_serialized', None)
        model_name = (
            serialized_dict.get('name', 'unknown')
            if isinstance(serialized_dict, dict)
            else 'unknown'
        )

        self.lens.trace_llm_call(
            agent_name=self.agent_name,
            model=model_name,
            prompt=prompts[0] if prompts else "",
            response=response_text,
            tokens=tokens,
            duration_ms=duration_ms,
        )

    def on_tool_start(self, serialized: dict, input_str: str, **kwargs):
        self._tool_start_time = time.time()
        self._tool_name = serialized.get('name', 'unknown')
        self._tool_input = input_str

    def on_tool_end(self, output: str, **kwargs):
        duration_ms = int((time.time() - getattr(self, '_tool_start_time', time.time())) * 1000)
        self.lens.trace_tool_call(
            agent_name=self.agent_name,
            tool_name=getattr(self, '_tool_name', 'unknown'),
            tool_input={"input": getattr(self, '_tool_input', '')},
            tool_output=output,
            duration_ms=duration_ms,
        )

    def on_tool_error(self, error: Exception, **kwargs):
        self.lens.trace_error(
            agent_name=self.agent_name,
            error_message=str(error),
            error_type=type(error).__name__,
        )
