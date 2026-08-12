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
              'has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px]',
              !revealed && 'hover:bg-accent/50',
              revealed && 'cursor-default',
              isSelected && !revealed && 'border-primary bg-primary/5',
              showAsCorrect && 'border-emerald-500/60 bg-emerald-500/10',
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
                  'border-primary bg-primary text-primary-foreground',
                showAsCorrect && 'border-emerald-600 bg-emerald-600 text-white',
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
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Correct
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
