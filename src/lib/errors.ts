import { ConvexError } from "convex/values";

/**
 * The message to show a player for a failed call.
 *
 * Convex redacts uncaught errors to "Server Error" in production, so anything
 * a player is meant to read has to be thrown as a ConvexError — its payload
 * reaches the client verbatim. Anything else is a genuine fault and gets a
 * generic line rather than a stack trace.
 */
export function userMessage(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  return "Something went wrong. Please try again.";
}
