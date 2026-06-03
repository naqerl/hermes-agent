"""Tests for goal_mode judge gate — preventing premature kanban_complete bypass.

See issue #38367: goal_mode tasks transition to done via kanban_complete
without a synchronous judge evaluation, letting workers mark incomplete
work as done.
"""

from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb


@pytest.fixture
def kanban_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    return home


def test_goal_mode_task_rejects_kanban_complete_without_judge_gate(kanban_home):
    """A goal_mode task must NOT transition to done via complete_task
    without a synchronous judge gate evaluating the summary.
    """
    with kb.connect() as conn:
        tid = kb.create_task(
            conn,
            title="goal task: implement feature X with verified evidence",
            assignee="worker",
            goal_mode=True,
            goal_max_turns=5,
        )
        task = kb.get_task(conn, tid)
        assert task.goal_mode is True
        assert task.status != "done"

        # Attempt to complete — should be rejected because the
        # summary hasn't been judged against the goal.
        with pytest.raises((ValueError, RuntimeError)):
            kb.complete_task(
                conn,
                tid,
                result="continuation_created: t_abc; not terminal",
                summary="root_continuation_created: t_abc; not terminal",
            )

        # Task must NOT be done — the judge gate should have blocked it.
        task = kb.get_task(conn, tid)
        assert task.status != "done", (
            "goal_mode task transitioned to done without judge evaluation"
        )


def test_goal_mode_task_blocks_incomplete_summary(kanban_home):
    """A summary that admits incomplete work should be gated away from done."""
    with kb.connect() as conn:
        tid = kb.create_task(
            conn,
            title="deliver feature Y to production",
            assignee="worker",
            goal_mode=True,
        )
        task = kb.get_task(conn, tid)
        assert task.goal_mode is True

        with pytest.raises((ValueError, RuntimeError)):
            kb.complete_task(
                conn,
                tid,
                result="partial progress",
                summary="still working on it, not done yet",
            )

        task = kb.get_task(conn, tid)
        assert task.status != "done"


def test_non_goal_mode_task_completes_normally(kanban_home):
    """Non-goal-mode tasks must still complete without any judge gate."""
    with kb.connect() as conn:
        tid = kb.create_task(conn, title="plain task", assignee="worker")
        task = kb.get_task(conn, tid)
        assert task.goal_mode is False

        ok = kb.complete_task(conn, tid, result="all done")
        assert ok is True

        task = kb.get_task(conn, tid)
        assert task.status == "done"
