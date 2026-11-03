"""Local end-to-end tests for the output-only PR Agent controller."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_FILE = Path(__file__).resolve().parents[1] / "pr-agent" / "controller.py"
spec = importlib.util.spec_from_file_location("pr_agent_controller", MODULE_FILE)
controller = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(controller)


def command(*args: str, cwd: Path) -> str:
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          capture_output=True).stdout.strip()


class PRControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo = root / "repo"
        self.remote = root / "remote.git"
        self.output = root / "output"
        self.repo.mkdir()
        command("git", "init", "--initial-branch=main", cwd=self.repo)
        command("git", "config", "user.name", "Test", cwd=self.repo)
        command("git", "config", "user.email", "test@example.com", cwd=self.repo)
        (self.repo / "shared.txt").write_text("start\n")
        command("git", "add", "-A", cwd=self.repo)
        command("git", "commit", "-m", "initial", cwd=self.repo)
        command("git", "init", "--bare", str(self.remote), cwd=root)
        command("git", "remote", "add", "origin", str(self.remote), cwd=self.repo)
        command("git", "push", "-u", "origin", "main", cwd=self.repo)
        command("git", "checkout", "-b", "feature", cwd=self.repo)
        (self.repo / "shared.txt").write_text("feature\n")
        command("git", "commit", "-am", "feature edit", cwd=self.repo)
        command("git", "push", "-u", "origin", "feature", cwd=self.repo)
        self.head_sha = command("git", "rev-parse", "HEAD", cwd=self.repo)
        command("git", "checkout", "main", cwd=self.repo)
        (self.repo / "shared.txt").write_text("base\n")
        command("git", "commit", "-am", "base edit", cwd=self.repo)
        command("git", "push", "origin", "main", cwd=self.repo)
        self.base_sha = command("git", "rev-parse", "HEAD", cwd=self.repo)
        command("git", "checkout", "feature", cwd=self.repo)
        self.event = root / "event.json"
        self.event.write_text(json.dumps({"pull_request": {
            "number": 12,
            "base": {"ref": "main", "sha": self.base_sha},
            "head": {"ref": "feature", "sha": self.head_sha,
                     "repo": {"full_name": "someone/agentic-swe"}},
        }}))
        self.env = {
            "GITHUB_WORKSPACE": str(self.repo),
            "GITHUB_EVENT_PATH": str(self.event),
            "GITHUB_REPOSITORY": "zc6600/agentic-swe",
            "PR_AGENT_OUTPUT_DIR": str(self.output),
            "OPENROUTER_API_KEY": "test-openrouter-key",
            "GH_TOKEN": "should-not-be-exposed",
            "PR_AGENT_VALIDATION_COMMAND": "test -f shared.txt",
        }

    def execute(self, agent_callback, *, trigger="conflict-only"):
        normal_run = controller.run
        def fake_run(args, **kwargs):
            if args[0] == "npx":
                self.assertNotIn("GH_TOKEN", kwargs["env"])
                self.assertNotIn("GITHUB_TOKEN", kwargs["env"])
                self.assertNotIn("PR_AGENT_TOKEN", kwargs["env"])
                return agent_callback()
            if args[0] == "bash":
                self.assertNotIn("GH_TOKEN", kwargs["env"])
                self.assertNotIn("OPENROUTER_API_KEY", kwargs["env"])
            return normal_run(args, **kwargs)
        with patch.dict(os.environ, {**self.env, "PR_AGENT_TRIGGER_ON": trigger}):
            with patch.object(controller, "run", side_effect=fake_run):
                code = controller.main()
        report = json.loads((self.output / "result.json").read_text())
        return code, report

    def test_conflict_produces_patch_and_json_without_push(self):
        def agent():
            (self.repo / "shared.txt").write_text("feature and base\n")
            return subprocess.CompletedProcess(["npx"], 0, "Resolved\nPASS\n", "")
        code, report = self.execute(agent)
        self.assertEqual(code, 0)
        self.assertEqual(report["verdict"], "PASS")
        self.assertTrue(report["conflicts_found"])
        self.assertTrue(report["validation_passed"])
        self.assertTrue(report["has_changes"])
        self.assertEqual(report["head_repo"], "someone/agentic-swe")
        self.assertEqual(report["base_sha"], self.base_sha)
        self.assertEqual(command("git", "--git-dir", str(self.remote), "rev-parse", "refs/heads/feature", cwd=self.repo), self.head_sha)
        self.assertEqual(command("git", "rev-parse", "HEAD", cwd=self.repo), self.head_sha)
        patch_file = self.output / "repair.patch"
        self.assertEqual(__import__("hashlib").sha256(patch_file.read_bytes()).hexdigest(), report["patch_sha256"])
        # Publishing this patch is possible from the original PR tip.
        command("git", "merge", "--abort", cwd=self.repo)
        command("git", "apply", "--check", str(patch_file), cwd=self.repo)

    def test_conflict_block_does_not_emit_patch(self):
        def agent():
            return subprocess.CompletedProcess(["npx"], 0, "BLOCK\n", "")
        code, report = self.execute(agent)
        self.assertEqual(code, 1)
        self.assertEqual(report["verdict"], "BLOCK")
        self.assertFalse(report["has_changes"])
        self.assertEqual((self.output / "repair.patch").read_bytes(), b"")

    def test_untracked_workflow_modification_is_blocked(self):
        def agent():
            (self.repo / "shared.txt").write_text("resolved\n")
            folder = self.repo / ".github" / "workflows"
            folder.mkdir(parents=True)
            (folder / "evil.yml").write_text("on: push\n")
            return subprocess.CompletedProcess(["npx"], 0, "PASS\n", "")
        code, report = self.execute(agent)
        self.assertEqual(code, 1)
        self.assertEqual(report["verdict"], "BLOCK")
        self.assertIn(".github", report["reason"])

    def test_clean_merge_skips_model_and_does_not_publish(self):
        command("git", "checkout", "main", cwd=self.repo)
        (self.repo / "shared.txt").write_text("start\n")
        command("git", "commit", "-am", "restore base", cwd=self.repo)
        command("git", "push", "origin", "main", cwd=self.repo)
        command("git", "checkout", "feature", cwd=self.repo)
        def should_not_be_called():
            self.fail("Model must be skipped on a clean merge")
        code, report = self.execute(should_not_be_called)
        self.assertEqual(code, 0)
        self.assertEqual(report["verdict"], "PASS")
        self.assertEqual(report["reason"], "no-conflicts")
        self.assertFalse(report["agent_invoked"])
        self.assertIsNone(report["validation_passed"])
        self.assertFalse(report["has_changes"])

    def test_stale_checkout_is_rejected(self):
        self.env["GITHUB_WORKSPACE"] = str(self.repo)
        self.head_sha = "0" * 40
        data = json.loads(self.event.read_text())
        data["pull_request"]["head"]["sha"] = self.head_sha
        self.event.write_text(json.dumps(data))
        with patch.dict(os.environ, self.env):
            rc = controller.main()
        report = json.loads((self.output / "result.json").read_text())
        self.assertEqual(rc, 1)
        self.assertEqual(report["verdict"], "BLOCK")
        self.assertIn("differs", report["reason"])


if __name__ == "__main__":
    unittest.main()
