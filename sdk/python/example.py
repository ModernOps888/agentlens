"""
Example: Trace an OpenAI agent pipeline with AgentLens.

1. Start AgentLens:    cd agentlens && npm run dev
2. Run this script:    pip install requests openai && python example.py
3. Open browser:       http://localhost:3000 (toggle to "Live Mode")
"""

from agentlens import AgentLens

# ─── Initialize AgentLens ────────────────────────────────────────────────────
lens = AgentLens(session_name="Research & Write Pipeline")

# ─── Option A: Automatic OpenAI wrapping ─────────────────────────────────────
# from openai import OpenAI
# client = lens.wrap_openai(OpenAI(), agent_name="Researcher")
# response = client.chat.completions.create(
#     model="gpt-5.4-mini",  # Updated June 2026: gpt-4o-mini deprecated
#     messages=[{"role": "user", "content": "Research AI agent trends in 2026"}],
# )
# print(response.choices[0].message.content)

# ─── Option B: Manual tracing (no API key needed for demo) ──────────────────

# Step 1: Orchestrator decides what to do
lens.trace_decision(
    agent_name="Orchestrator",
    reason="Starting research phase. Topic: AI agent observability tools.",
    duration_ms=120,
)

# Step 2: Orchestrator spawns a Researcher agent
lens.trace_agent_spawn(
    parent_agent="Orchestrator",
    spawned_agent="Researcher",
    reason="Delegating web research to specialized agent",
)

# Step 3: Researcher makes an MCP tool call to search the web
lens.trace_mcp_call(
    agent_name="Researcher",
    server_name="web-search",
    tool_name="search",
    params={"query": "AI agent debugging tools 2026", "max_results": 5},
    result={"results": [
        {"title": "LangSmith - Trace LLM Applications", "url": "https://langsmith.com"},
        {"title": "AgentOps - Agent Monitoring", "url": "https://agentops.ai"},
    ]},
    duration_ms=2100,
)

# Step 4: Researcher makes an LLM call to synthesize findings
lens.trace_llm_call(
    agent_name="Researcher",
    model="gpt-5.4-mini",  # Updated June 2026: gpt-4o-mini deprecated
    provider="openai",
    prompt="Synthesize the following research results into a structured brief about AI agent debugging tools...",
    system_prompt="You are a research analyst specializing in AI/ML developer tools.",
    response="## AI Agent Debugging Landscape 2026\n\nThe market for agent observability tools is growing rapidly...",
    tokens={"prompt_tokens": 450, "completion_tokens": 380, "total_tokens": 830},
    temperature=0.3,
    duration_ms=3200,
)

# Step 5: Orchestrator decides to proceed to writing
lens.trace_decision(
    agent_name="Orchestrator",
    reason="Research complete. Quality score: 8.5/10. Proceeding to draft phase.",
    duration_ms=200,
)

# Step 6: Orchestrator spawns a Writer
lens.trace_agent_spawn(
    parent_agent="Orchestrator",
    spawned_agent="Writer",
    reason="Delegating content writing to Writer agent",
)

# Step 7: Writer generates the draft
lens.trace_llm_call(
    agent_name="Writer",
    model="gpt-5.4",  # Updated June 2026: gpt-4o deprecated
    provider="openai",
    prompt="Write a LinkedIn post about the rise of AI agent debugging tools. Use the research brief as context.",
    response="🔍 The #1 problem nobody talks about in AI agents: debugging.\n\nWhen your 5-agent pipeline silently fails...",
    tokens={"prompt_tokens": 800, "completion_tokens": 520, "total_tokens": 1320},
    temperature=0.7,
    duration_ms=4500,
)

# Step 8: End the session
lens.end(status="completed")

print("[OK] Trace sent to AgentLens! Open http://localhost:3000 to view.")
print(f"     Session ID: {lens.session_id}")
