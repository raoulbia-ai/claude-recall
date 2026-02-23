# Claude Recall — Expected Behavior (v0.15.13)

Use this document to evaluate how well Claude Recall is performing in consumer projects. Paste the assessment prompt below into a conversation and ask Claude to self-evaluate.

## Assessment Prompt

Evaluate how well Claude Recall is performing against these expectations:

**1. Load rules before acting**
- The `search_enforcer` hook blocks Write/Edit/Bash until `load_rules` is called (1-minute TTL, so it re-fires per task)
- Expected: Claude calls `load_rules` before its first code action in each task. This should be automatic due to the hook — not something Claude decides to skip.

**2. Visible rule application**
- The `load_rules` response includes a directive requiring Claude to output an "Applying memories:" section before its first action
- Expected: Before every Write/Edit/Bash, Claude states which loaded rules apply to the current task. If none apply, it says so. This is visible to the user, not internal reasoning.

**3. Actual compliance with loaded rules**
- Expected: If a rule says "check git branch before code changes," Claude actually runs `git branch`. Not just citing the rule and skipping the action. Loading + citing without following through is compliance theater.

**4. Inline citations**
- Expected: When a rule influences an action, Claude adds `(applied from memory: <rule summary>)` inline so the user sees which memories are driving decisions.

**5. Auto-capture quality**
- Hooks auto-capture corrections, preferences from user messages
- Expected: Only actionable, reusable rules are stored. Conversational fragments, questions, typo-filled casual messages, and Claude's own responses should NOT be stored. If junk gets through, note the content.

**6. Store with permission**
- Expected: Before calling `store_memory`, Claude tells the user what it plans to store and asks for confirmation. No silent storing.

**Please assess**: For each of the 6 points above, is it working, partially working, or not working? Provide specific examples from this session.
