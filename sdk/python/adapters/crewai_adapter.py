"""
AgentLens Adapter for CrewAI

Automatically traces all CrewAI agent tasks, tool usage, and delegation.

Usage:
    from crewai import Agent, Task, Crew
    from agentlens import AgentLens
    from agentlens.adapters.crewai_adapter import TracedCrew

    lens = AgentLens(session_name="My CrewAI Pipeline")

    researcher = Agent(role="Researcher", ...)
    writer = Agent(role="Writer", ...)
    task1 = Task(description="Research AI trends", agent=researcher)
    task2 = Task(description="Write blog post", agent=writer)

    crew = Crew(agents=[researcher, writer], tasks=[task1, task2])
    traced_crew = TracedCrew(crew, lens)
    result = traced_crew.kickoff()

    lens.end()
"""

import time
import json
from typing import Any, Optional
from agentlens import AgentLens


class TracedCrew:
    """Wraps a CrewAI Crew to automatically trace task execution."""

    def __init__(self, crew: Any, lens: AgentLens):
        self.crew = crew
        self.lens = lens
        self._patch_agents()

    def _patch_agents(self):
        """Wrap each agent's execute_task to trace execution."""
        if hasattr(self.crew, 'agents'):
            for agent in self.crew.agents:
                original_execute = getattr(agent, 'execute_task', None)
                if original_execute:
                    agent.execute_task = self._make_traced_execute(agent, original_execute)

    def _make_traced_execute(self, agent: Any, original_fn: Any):
        lens = self.lens

        def traced_execute(task: Any, *args, **kwargs):
            agent_name = getattr(agent, 'role', 'Agent')
            task_desc = getattr(task, 'description', '')[:200]

            lens.trace_decision(
                agent_name=agent_name,
                reason=f"Starting task: {task_desc}",
            )

            start = time.time()
            try:
                result = original_fn(task, *args, **kwargs)
                duration_ms = int((time.time() - start) * 1000)

                result_str = str(result)[:500] if result else ""
                llm_obj = getattr(agent, 'llm', None)
                model_name = (
                    getattr(llm_obj, 'model', None)
                    or getattr(llm_obj, 'model_name', None)
                    or (llm_obj if isinstance(llm_obj, str) else 'unknown')
                )
                model_name = str(model_name)[:50]

                lens.trace_llm_call(
                    agent_name=agent_name,
                    model=model_name,
                    provider="crewai",
                    prompt=task_desc,
                    response=result_str,
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

        return traced_execute

    def kickoff(self, *args, **kwargs):
        """Run the crew with tracing."""
        agent_names = [getattr(a, 'role', 'Agent') for a in getattr(self.crew, 'agents', [])]
        task_count = len(getattr(self.crew, 'tasks', []))

        self.lens.trace_decision(
            agent_name="CrewAI",
            reason=f"Kicking off crew with {len(agent_names)} agents ({', '.join(agent_names)}) and {task_count} tasks",
        )

        # Trace agent spawns
        for name in agent_names:
            self.lens.trace_agent_spawn(
                parent_agent="CrewAI",
                spawned_agent=name,
                reason=f"Crew member: {name}",
            )

        result = self.crew.kickoff(*args, **kwargs)

        self.lens.trace_decision(
            agent_name="CrewAI",
            reason=f"Crew completed. Result length: {len(str(result))} chars",
        )

        return result


class CrewAIStepCallback:
    """
    CrewAI step callback for fine-grained tracing.

    Usage:
        from crewai import Crew
        callback = CrewAIStepCallback(lens)
        crew = Crew(..., step_callback=callback)
    """

    def __init__(self, lens: AgentLens):
        self.lens = lens

    def __call__(self, step_output: Any):
        """Called after each agent step."""
        agent_name = "CrewAI"
        
        if hasattr(step_output, 'agent'):
            agent_name = getattr(step_output.agent, 'role', 'Agent')

        if hasattr(step_output, 'tool'):
            self.lens.trace_tool_call(
                agent_name=agent_name,
                tool_name=str(step_output.tool),
                tool_input={"input": str(getattr(step_output, 'tool_input', ''))[:200]},
                tool_output=str(getattr(step_output, 'result', ''))[:500],
            )
        elif hasattr(step_output, 'text'):
            self.lens.trace_llm_call(
                agent_name=agent_name,
                model="crewai",
                prompt="",
                response=str(step_output.text)[:500],
            )
