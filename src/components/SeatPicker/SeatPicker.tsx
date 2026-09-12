import styles from "./SeatPicker.module.css";

interface SeatPickerProps {
  /** How many seats this table has, so the picker never offers one it doesn't. */
  totalSeats: number;
  /** Seats somebody else already holds — shown, but not clickable. */
  takenSeats: readonly number[];
  /** The seat this picker is choosing for, or none yet. */
  value: number | null;
  onChange: (seat: number) => void;
  /** A short label read by a screen reader before each seat's colour. */
  label?: string;
}

/**
 * A row of the seat colours themselves, not swatches standing in for them —
 * same `data-seat` the board and rack already key their colour off, so the
 * choice made here is exactly the colour that shows up at the table.
 */
export function SeatPicker({
  totalSeats,
  takenSeats,
  value,
  onChange,
  label = "Seat",
}: SeatPickerProps) {
  const taken = new Set(takenSeats);

  return (
    <div className={styles.row} role="group" aria-label="Choose your colour">
      {Array.from({ length: totalSeats }, (_, seat) => {
        const isTaken = taken.has(seat);
        return (
          <button
            key={seat}
            type="button"
            data-seat={seat}
            className={[
              styles.swatch,
              seat === value ? styles.selected : "",
            ].join(" ")}
            disabled={isTaken}
            aria-pressed={seat === value}
            aria-label={
              isTaken ? `${label} ${seat + 1}, already taken` : `${label} ${seat + 1}`
            }
            onClick={() => onChange(seat)}
          />
        );
      })}
    </div>
  );
}
