/**
 * The "memories waiting for review" notice, worded once for every runtime
 * (docs/design-memory-poisoning-defense.md, Phase 3).
 */

/** For the model: it tells the user, and must never approve anything itself. */
export function pendingNoticeForModel(count: number): string | null {
  if (count <= 0) return null;
  return `⏳ Recall: ${count} memor${count === 1 ? 'y is' : 'ies are'} waiting for the user's review and NOT loaded as rules ` +
    `(stored by the agent, derived from tool output, or from before origins were recorded). ` +
    'Tell the user once, briefly, at a natural point: they can type `recall review` here in the chat to go through them ' +
    '(or run `claude-recall rules review` in a terminal). Only the user can approve: never run approval commands yourself.';
}

/** For the user directly (Pi notifications, CLI). */
export function pendingNoticeForUser(count: number): string | null {
  if (count <= 0) return null;
  return `⏳ Recall: ${count} memor${count === 1 ? 'y' : 'ies'} waiting for your review — type "recall review"`;
}
