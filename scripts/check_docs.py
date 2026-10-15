
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


def check_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    count = count_words(text)
    limit = get_limit(path)

    if count <= limit:
        return True

    print(f"FAIL: {path}")
    print(f"  Type: Count: {count} / {limit} (exceeded by {count - limit}), A document should be no longer than 4000 words, while a README.md should be no longer than 2000 words. ")
    print("  Reason: Excessive documentation length makes")
    print("          codebases harder to navigate and maintain.")

    if limit == README_LIMIT:
        print("  Fix: Keep the README focused on orientation and")
        print("       move detailed explanations into docs/.")
    else:
        print("  Fix: Split the document by responsibility and")
        print("       provide navigation links between sections.")


    # GitHub Actions annotation for agents and reviewers
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(
            f"::error file={path},title=Documentation too long::"
            f"Counted {count} words; limit is {limit}. "
            "Keep documents concise. Move detailed content "
            "into focused documents and add navigation links."
        )

    print()
    return False


def main() -> int:
    root = Path.cwd()
    docs = sorted(find_docs(root))

    failures = 0
    for path in docs:
        try:
            if not check_file(path.relative_to(root)):
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

    

    