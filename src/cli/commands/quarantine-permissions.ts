/**
 * Claude Code deny rules that keep the agent from approving quarantined
 * memories through its Bash tool (docs/design-memory-poisoning-defense.md).
 *
 * Approval is the user's: in chat ("recall review", handled by a hook before
 * the agent sees it), with `!` commands, or in a terminal. None of those go
 * through the agent's tools, so these rules don't get in the user's way.
 *
 * Claude Code's own docs say a Bash deny rule "isn't a security boundary":
 * the same program in another form (inside `sh -c`, by absolute path to node,
 * a direct database edit) isn't matched. These rules close the obvious path;
 * the change history records whatever happens.
 */
export const QUARANTINE_DENY_RULES: readonly string[] = [
  'Bash(* rules approve *)',
  'Bash(* rules approve)',
  'Bash(*CLAUDE_RECALL_QUARANTINE*)',
];

/** Rules from QUARANTINE_DENY_RULES not yet in settings.permissions.deny. */
export function missingQuarantineDenyRules(settings: any): string[] {
  const deny: unknown = settings?.permissions?.deny;
  const have = new Set(Array.isArray(deny) ? deny.filter(d => typeof d === 'string') : []);
  return QUARANTINE_DENY_RULES.filter(r => !have.has(r));
}

/** Add the missing rules in place. Returns how many were added. */
export function addQuarantineDenyRules(settings: any): number {
  const missing = missingQuarantineDenyRules(settings);
  if (missing.length === 0) return 0;
  settings.permissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {};
  const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  settings.permissions.deny = [...deny, ...missing];
  return missing.length;
}
