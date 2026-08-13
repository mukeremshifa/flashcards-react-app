import { CheckIcon, XIcon } from 'lucide-react';
import type { McqPayload } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The options for a multiple-choice card.
 *
 * SPEC §12 (7): the choice auto-grades into FSRS — correct becomes Good, wrong
 * becomes Again — so this component's job is to record which option was picked
 * and then show, plainly, which one was right. The rating buttons stay visible
 * for the manual override.
 */
export function McqOptions({
  payload,
  selected,
  onSelect,
  revealed,
}: {
  payload: McqPayload;
  selected: number | null;
  onSelect?: (index: number) => void;
  revealed: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={revealed}>
      <legend className="sr-only">Choose an answer</legend>
      {payload.options.map((option, index) => {
        const isSelected = selected === index;
        const showAsCorrect = revealed && option.correct;
        const showAsWrong = revealed && isSelected && !option.correct;

        return (
          <label
            key={index}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
              'has-[:focus-visible]:ring-ring has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2',
              !revealed && 'hover:bg-accent/50',
              revealed && 'cursor-default',
              // Neutral means "you picked this"; the accent is reserved for "this
              // is the answer", so the two never have to be told apart by shade.
              isSelected && !revealed && 'border-foreground bg-accent',
              showAsCorrect && 'border-primary bg-primary/20',
              showAsWrong && 'border-destructive/60 bg-destructive/10',
            )}
          >
            <input
              type="radio"
              name="mcq-option"
              className="sr-only"
              checked={isSelected}
              onChange={() => onSelect?.(index)}
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                isSelected &&
                  !revealed &&
                  'border-foreground bg-foreground text-background',
                showAsCorrect && 'border-primary bg-primary text-primary-foreground',
                showAsWrong && 'border-destructive bg-destructive text-white',
              )}
            >
              {showAsCorrect ? (
                <CheckIcon className="size-3" />
              ) : showAsWrong ? (
                <XIcon className="size-3" />
              ) : (
                String.fromCharCode(65 + index)
              )}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
            {revealed && option.correct && (
              <span className="bg-primary text-primary-foreground rounded-sm px-1.5 py-0.5 text-xs font-semibold">
                Correct
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
