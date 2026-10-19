/**
 * What the button under a finished game says. The first person to press it
 * makes the rematch; after that there is one table, so everybody else is
 * asked to join it rather than offered to start another, and whoever is
 * already sitting there is simply taken back to it.
 */
export function rematchLabel(rematch: { joined: boolean } | null): string {
  if (rematch === null) return "Play again";
  return rematch.joined ? "Go to rematch" : "Join rematch";
}
