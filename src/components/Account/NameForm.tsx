import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { checkDisplayName, DISPLAY_NAME_MAX } from "../../../shared/names";
import { userMessage } from "../../lib/errors";
import styles from "./Account.module.css";

interface NameFormProps {
  /** The name already chosen, if any. */
  current: string | null;
  /** What the field starts with, when that is not `current`. */
  initial?: string | null;
  submitLabel: string;
  /** The button's label while the field still holds `initial` untouched. */
  keepLabel?: string;
  onSaved?: () => void;
  /**
   * Into the field on arrival. For the prompt, which asks for nothing else;
   * on the account page it would skip the reader past everything above it.
   */
  autoFocus?: boolean;
}

/** The one field for choosing what other players see, wherever it is asked. */
export function NameForm({
  current,
  initial,
  submitLabel,
  keepLabel,
  onSaved,
  autoFocus = false,
}: NameFormProps) {
  const save = useMutation(api.users.setDisplayName);
  // The prompt and the account page can both be up at once.
  const id = useId();
  const noteId = `${id}-note`;
  const [value, setValue] = useState(initial ?? current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const checked = checkDisplayName(value);
  const unchanged = checked.ok && checked.name === current;

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!checked.ok) {
          setError(checked.reason);
          return;
        }
        setError(null);
        setSaving(true);
        save({ name: checked.name })
          .then(() => {
            setSaved(true);
            onSaved?.();
          })
          .catch((err: unknown) => setError(userMessage(err)))
          .finally(() => setSaving(false));
      }}
    >
      <label className={styles.label} htmlFor={id}>
        Display name
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={styles.input}
          value={value}
          maxLength={DISPLAY_NAME_MAX + 8}
          autoComplete="nickname"
          autoFocus={autoFocus}
          aria-invalid={error !== null}
          aria-describedby={noteId}
          placeholder="What should other players call you?"
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
            setError(null);
          }}
        />
        <button
          type="submit"
          className={styles.button}
          disabled={saving || unchanged || value.trim() === ""}
        >
          {saving
            ? "Saving…"
            : keepLabel !== undefined && value === initial
              ? keepLabel
              : submitLabel}
        </button>
      </div>
      {/* One id whichever is showing, so the field is always described by
          what is under it. */}
      {error ? (
        <p className={styles.error} id={noteId} role="alert">
          {error}
        </p>
      ) : saved && unchanged ? (
        <p className={styles.hint} id={noteId}>
          Saved.
        </p>
      ) : (
        <p className={styles.hint} id={noteId}>
          Everyone you play sees this name. It does not have to be your real one.
        </p>
      )}
    </form>
  );
}
