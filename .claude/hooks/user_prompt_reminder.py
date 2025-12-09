#!/usr/bin/env python3
"""
User Prompt Reminder Hook for Claude Recall.

Injects a visible reminder into Claude's context on every user prompt,
encouraging memory search before responding.

This hook outputs to stdout (exit 0) which Claude sees in its context.

Exit codes:
- 0: Always allow (non-blocking, but reminder is visible)
"""
import json
import sys


def extract_keywords(prompt: str) -> str:
    """Extract meaningful keywords from prompt for suggested search."""
    # Common words to filter out
    stop_words = {
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'under', 'again',
        'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
        'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
        'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        's', 't', 'just', 'don', 'now', 'i', 'me', 'my', 'we', 'you', 'your',
        'it', 'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who',
        'please', 'help', 'want', 'need', 'like', 'make', 'get', 'let', 'put'
    }

    # Extract words, filter stop words, take first 4 meaningful words
    words = prompt.lower().split()
    keywords = [w.strip('.,!?;:\'"()[]{}') for w in words if w.lower() not in stop_words]
    keywords = [w for w in keywords if len(w) > 2]  # Filter short words

    return ' '.join(keywords[:4]) if keywords else 'preferences patterns'


def main():
    try:
        hook_data = json.load(sys.stdin)
        prompt = hook_data.get('prompt', '') or hook_data.get('content', '') or ''

        # Skip if prompt is very short (likely a typo or continuation)
        if len(prompt.strip()) < 5:
            sys.exit(0)

        # Extract keywords for suggested search
        keywords = extract_keywords(prompt)

        # Output reminder (Claude will see this)
        reminder = f"""<user-prompt-submit-hook>
🔍 Search memories before responding: mcp__claude-recall__search("{keywords}")
</user-prompt-submit-hook>"""

        print(reminder)
        sys.exit(0)

    except json.JSONDecodeError:
        sys.exit(0)
    except Exception:
        sys.exit(0)


if __name__ == '__main__':
    main()
