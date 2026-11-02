
"""Documentation Guard: enforce repository documentation length limits."""

import argparse
import os
import re
import sys
from pathlib import Path

DEFAULT_README_LIMIT = 2000
DEFAULT_DOC_LIMIT = 4000

# One Chinese character or one English word counts as one unit.
WORD_PATTERN = re.compile(
    r"[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*"
)

EXCLUDED_DIRS = {".git", ".venv", "node_modules", "__pycache__", "dist"}


def count_words(text: str) -> int:
    return len(WORD_PATTERN.findall(text))


def get_limit(path: Path, readme_limit: int, doc_limit: int) -> int:
    if path.stem.lower() == "readme":
        return readme_limit
    return doc_limit


def find_docs(root: Path):
    for directory, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        for name in files:
            path = Path(directory) / name
            if path.suffix.lower() in {".md", ".mdx"}:
                yield path



def check_file(path: Path, root: Path, readme_limit: int, doc_limit: int) -> bool:
    display_path = path.relative_to(root)
    text = path.read_text(encoding="utf-8")
    count = count_words(text)
    limit = get_limit(path, readme_limit, doc_limit)

    if count <= limit:
        return True

    # 1. Identify the violated specification
    if path.stem.lower() == "readme":
        spec = (
            f"README.md must not exceed {limit} words "
            f"(actual: {count}, exceeded by {count - limit})."
        )
        fix = (
            "Keep the README focused on orientation and "
            "move detailed explanations into docs/."
        )
    else:
        spec = (
            f"Documentation must not exceed {limit} words "
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




def positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a whole number")
    if number < 1:
        raise argparse.ArgumentTypeError("limit must be at least 1")
    return number


def env_limit(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return positive_int(raw)
    except argparse.ArgumentTypeError as exc:
        print(f"ERROR: Invalid {name}: {exc}", file=sys.stderr)
        sys.exit(2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Documentation Guard: enforce Markdown word limits.")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument(
        "--readme-limit", type=positive_int,
        default=env_limit("README_LIMIT", DEFAULT_README_LIMIT),
        help=f"Max words for README files (default {DEFAULT_README_LIMIT}, env README_LIMIT).",
    )
    parser.add_argument(
        "--doc-limit", type=positive_int,
        default=env_limit("DOC_LIMIT", DEFAULT_DOC_LIMIT),
        help=f"Max words for other .md/.mdx files (default {DEFAULT_DOC_LIMIT}, env DOC_LIMIT).",
    )
    args = parser.parse_args()

    root = Path(args.directory).resolve()

    if not root.is_dir():
        print(f"ERROR: Invalid directory: {root}", file=sys.stderr)
        return 2

    docs = sorted(find_docs(root))

    failures = 0
    for path in docs:
        try:
            if not check_file(path, root, args.readme_limit, args.doc_limit):
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
