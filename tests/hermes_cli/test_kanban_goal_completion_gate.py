"""Tests for goal_mode judge gate at the tool handler level.

See issue #38367: goal_mode tasks must not transition to done via
kanban_complete without a synchronous judge evaluation. The gate is
implemented in _handle_complete in tools/kanban_tools.py.
"""

import json
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from tools import kanban_tools as kt


@pytest.fixture
def goal_task_env(monkeypatch, tmp_path):
    """Set up a goal_mode task and return its id with env vars configured."""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_PROFILE", "test-worker")
    monkeypatch.delenv("HERMES_SESSION_ID", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()

    conn = kb.connect()
    try:
        tid = kb.create_task(
            conn,
            title="goal-mode-test",
            assignee="test-worker",
            body="Must achieve X with verified evidence.",
            goal_mode=True,
        )
        kb.claim_task(conn, tid)
    finally:
        conn.close()

    monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
    return tid


def test_goal_mode_kanban_complete_rejected_by_judge(monkeypatch, goal_task_env):
    """Goal-mode task completion is rejected when the judge returns continue."""
    def mock_judge_goal(goal, last_response, **kwargs):
        return "continue", "missing verification evidence", False

    monkeypatch.setattr("hermes_cli.goals.judge_goal", mock_judge_goal)

    result = kt._handle_complete({"summary": "I did some work but not X"})
    data = json.loads(result)

    assert "error" in data
    assert "Goal completion rejected by judge" in data["error"]
    assert "missing verification evidence" in data["error"]

    conn = kb.connect()
    try:
        task = kb.get_task(conn, goal_task_env)
        assert task.status == "running"
    finally:
        conn.close()


def test_goal_mode_kanban_complete_allowed_when_judge_approves(monkeypatch, goal_task_env):
    """Goal-mode task completion succeeds when the judge returns done."""
    def mock_judge_goal(goal, last_response, **kwargs):
        return "done", "all criteria met", False

    monkeypatch.setattr("hermes_cli.goals.judge_goal", mock_judge_goal)

    result = kt._handle_complete({"summary": "X is complete, verified evidence attached"})
    data = json.loads(result)

    assert data.get("ok") is True

    conn = kb.connect()
    try:
        task = kb.get_task(conn, goal_task_env)
        assert task.status == "done"
    finally:
        conn.close()


def test_goal_mode_fails_open_when_judge_unavailable(monkeypatch, goal_task_env):
    """If judge_goal raises, the completion proceeds fail-open."""
    def mock_judge_goal(goal, last_response, **kwargs):
        raise RuntimeError("LLM API unavailable")

    monkeypatch.setattr("hermes_cli.goals.judge_goal", mock_judge_goal)

    result = kt._handle_complete({"summary": "work is done"})
    data = json.loads(result)

    assert data.get("ok") is True

    conn = kb.connect()
    try:
        task = kb.get_task(conn, goal_task_env)
        assert task.status == "done"
    finally:
        conn.close()


def test_non_goal_mode_task_completes_normally(monkeypatch, tmp_path):
    """Non-goal-mode tasks complete without judge evaluation."""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_PROFILE", "test-worker")
    monkeypatch.delenv("HERMES_SESSION_ID", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()

    conn = kb.connect()
    try:
        tid = kb.create_task(conn, title="plain task", assignee="test-worker")
        kb.claim_task(conn, tid)
    finally:
        conn.close()

    monkeypatch.setenv("HERMES_KANBAN_TASK", tid)

    result = kt._handle_complete({"summary": "all done"})
    data = json.loads(result)
    assert data.get("ok") is True

    conn = kb.connect()
    try:
        task = kb.get_task(conn, tid)
        assert task.status == "done"
    finally:
        conn.close()
