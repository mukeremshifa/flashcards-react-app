import { Button } from '@/components/ui/button';
import { formatInterval } from '@/lib/format';
import { GRADES, GRADE_LABELS, type SchedulePreview } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The four grades, each showing what it will do.
 *
 * "Good → 4d" before committing is the difference between rating honestly and
 * guessing. The intervals come from the same `previewSchedule` result that will
 * be written, so the number shown is the number the card gets.
 */
export function RatingButtons({
  preview,
  onRate,
  suggested,
  disabled,
}: {
  preview: SchedulePreview;
  onRate: (grade: Grade) => void;
  /** Auto-grade hint for multiple choice (SPEC §12). Still overridable. */
  suggested?: Grade | null;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GRADES.map((grade, index) => (
        <Button
          key={grade}
          type="button"
          variant={grade === Grade.Again ? 'destructive' : 'outline'}
          disabled={disabled}
          onClick={() => onRate(grade)}
          className={cn(
            'h-auto flex-col gap-0.5 py-2',
            suggested === grade && 'ring-primary/60 ring-2',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <kbd className="opacity-60">{index + 1}</kbd>
            {GRADE_LABELS[grade]}
          </span>
          <span className="text-xs opacity-70">
            {formatInterval(preview[grade].intervalMs)}
          </span>
        </Button>
      ))}
    </div>
  );
}
