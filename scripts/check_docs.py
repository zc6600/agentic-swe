
"""Enforce repository documentation length limits."""

import os
import re
import sys
from pathlib import Path

README_LIMIT = 2000
DOC_LIMIT = 4000

# One Chinese character or one English word counts as one unit.
WORD_PATTERN = re.compile(
    r"[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*"
)

EXCLUDED_DIRS = {".git", ".venv", "node_modules", "__pycache__", "dist"}


def count_words(text: str) -> int:
    return len(WORD_PATTERN.findall(text))


def get_limit(path: Path) -> int:
    if path.stem.lower() == "readme":
        return README_LIMIT
    return DOC_LIMIT


def find_docs(root: Path):
    for directory, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        for name in files:
            path = Path(directory) / name
            if path.suffix.lower() in {".md", ".mdx"}:
                yield path



def check_file(path: Path, root: Path) -> bool:
    display_path = path.relative_to(root)
    text = path.read_text(encoding="utf-8")
    count = count_words(text)
    limit = get_limit(path)

    if count <= limit:
        return True

    # 1. Identify the violated specification
    if limit == README_LIMIT:
        spec = (
            f"README.md must not exceed {README_LIMIT} words "
            f"(actual: {count}, exceeded by {count - limit})."
        )
        fix = (
            "Keep the README focused on orientation and "
            "move detailed explanations into docs/."
        )
    else:
        spec = (
            f"Documentation must not exceed {DOC_LIMIT} words "
            f"(actual: {count}, exceeded by {count - limit})."
        )
        fix = (
            "Split the document by responsibility and "
            "provide navigation links between sections."
        )

    reason = (
        "Excessive documentation length makes codebases "
        "harder to navigate and maintain."
    )

    # 2. Single source of truth for feedback
    feedback = (
        f"FAIL: {display_path}\n"
        f"  Type: {spec}\n"
        f"  Reason: {reason}\n"
        f"  Fix: {fix}"
    )

    # 3. Human-readable CI logs
    print(feedback)
    print()

    # 4. Machine-readable GitHub annotation
    if os.environ.get("GITHUB_ACTIONS") == "true":
        escaped = (
            feedback
            .replace("%", "%25")
            .replace("\r", "%0D")
            .replace("\n", "%0A")
        )
        print(
            f"::error file={display_path},title=Documentation too long::"
            f"{escaped}"
        )

    return False




def main() -> int:
    if len(sys.argv) > 2:
        print("Usage: check_docs.py [directory]", file=sys.stderr)
        return 2

    root = Path(sys.argv[1] if len(sys.argv) == 2 else ".").resolve()

    if not root.is_dir():
        print(f"ERROR: Invalid directory: {root}", file=sys.stderr)
        return 2

    docs = sorted(find_docs(root))

    failures = 0
    for path in docs:
        try:
            if not check_file(path, root):
                failures += 1
        except (OSError, UnicodeError) as exc:
            print(f"ERROR: Cannot read {path}: {exc}", file=sys.stderr)
            return 2

    if failures:
        print(f"FAILED: {failures} document(s) exceed their limits.")
        return 1

    print(f"PASSED: {len(docs)} document(s) checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
