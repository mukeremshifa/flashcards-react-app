import { useCallback, useRef, useState } from 'react';
import { useFieldArray, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, TrashIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CardPayload, CARD_KINDS, type CardKind } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import {
  draftCardCount,
  draftFromPayload,
  draftToPayloads,
  EMPTY_DRAFT,
  switchKind,
  type CardDraft,
} from './card-draft';

const KIND_LABELS: Record<CardKind, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  mcq: 'Multiple choice',
};

/**
 * Validation, through the one schema in schemas.ts.
 *
 * `zodResolver(CardPayload)` does the actual checking. This wrapper exists for
 * one reason: a cloze draft may stand for several cards, and each of them has to
 * be valid. Because the draft's field names match the payload's, the issue paths
 * zod produces already point at the right inputs.
 */
// Cast because the resolver validates a CardPayload while the form holds a
// CardDraft; the two agree on every field name, which is what makes the issue
// paths line up with the inputs.
const validatePayload = zodResolver(CardPayload) as unknown as Resolver<CardDraft>;

const draftResolver: Resolver<CardDraft> = async (draft, context, options) => {
  const candidates = draftToPayloads(draft);

  for (const candidate of candidates) {
    const result = await validatePayload(
      candidate as unknown as CardDraft,
      context,
      options,
    );
    const errors = result.errors as FieldErrors<CardDraft>;
    if (Object.keys(errors).length > 0) return { values: {}, errors };
  }

  return { values: draft, errors: {} };
};

export type CardEditorProps = {
  /** Editing an existing card, or null when adding a new one. */
  defaultValue?: CardPayload | null;
  /** Receives every card the draft produced — more than one for a split cloze. */
  onSubmit: (payloads: CardPayload[]) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
  className?: string;
};

export function CardEditor({
  defaultValue,
  onSubmit,
  onCancel,
  submitLabel = 'Save card',
  autoFocus = false,
  className,
}: CardEditorProps) {
  const [kind, setKind] = useState<CardKind>(defaultValue?.kind ?? 'basic');
  const clozeRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<CardDraft>({
    resolver: draftResolver,
    defaultValues: defaultValue ? draftFromPayload(defaultValue) : EMPTY_DRAFT,
    mode: 'onSubmit',
  });

  const {
    control,
    register,
    handleSubmit,
    formState,
    watch,
    getValues,
    reset,
    setValue,
  } = form;
  const options = useFieldArray({ control, name: 'options' });
  // Registered once so the wrap-selection button and react-hook-form can share
  // the same textarea node.
  const clozeField = register('text');
  const draft = watch();
  const cardCount = draftCardCount(draft);

  const changeKind = useCallback(
    (next: CardKind) => {
      // Reset with the carried-over draft rather than clearing: someone who
      // typed a sentence and then realised it wants a deletion should not have
      // to type it again.
      reset(switchKind(getValues(), next), { keepErrors: false });
      setKind(next);
    },
    [getValues, reset],
  );

  /** Wrap the selected text in the next free deletion group. */
  const wrapSelection = useCallback(() => {
    const field = clozeRef.current;
    if (!field) return;
    const { selectionStart, selectionEnd, value } = field;
    if (selectionStart === selectionEnd) return;

    const used = [...value.matchAll(/\{\{c(\d+)::/g)].map(match => Number(match[1]));
    const group = used.length === 0 ? 1 : Math.max(...used) + 1;
    const wrapped =
      value.slice(0, selectionStart) +
      `{{c${group}::${value.slice(selectionStart, selectionEnd)}}}` +
      value.slice(selectionEnd);

    setValue('text', wrapped, { shouldDirty: true, shouldValidate: false });
    field.focus();
  }, [setValue]);

  const submit = handleSubmit(async values => {
    await onSubmit(draftToPayloads(values));
  });

  const errors = formState.errors;

  return (
    <form onSubmit={submit} className={cn('space-y-4', className)} noValidate>
      <div className="space-y-2">
        <Label htmlFor="card-kind">Card type</Label>
        {/*
          A segmented control, not three accent-or-outline buttons. The accent on
          this form belongs to Save; spending it on "which of three types" as
          well left the editor with two things claiming to be the primary action
          (P6).
        */}
        <div
          id="card-kind"
          role="group"
          aria-label="Card type"
          className="bg-muted inline-flex gap-0.5 rounded-md p-0.5"
        >
          {CARD_KINDS.map(candidate => (
            <Button
              key={candidate}
              type="button"
              size="sm"
              variant={kind === candidate ? 'outline' : 'ghost'}
              aria-pressed={kind === candidate}
              onClick={() => changeKind(candidate)}
            >
              {KIND_LABELS[candidate]}
            </Button>
          ))}
        </div>
      </div>

      {kind === 'basic' && (
        <>
          <Field label="Front" error={errors.front?.message} htmlFor="card-front">
            <Textarea
              id="card-front"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.front)}
              placeholder="What is the powerhouse of the cell?"
              {...register('front')}
            />
          </Field>
          <Field label="Back" error={errors.back?.message} htmlFor="card-back">
            <Textarea
              id="card-back"
              aria-invalid={Boolean(errors.back)}
              placeholder="The mitochondrion"
              {...register('back')}
            />
          </Field>
        </>
      )}

      {kind === 'cloze' && (
        <>
          <Field
            label="Text"
            error={errors.text?.message}
            htmlFor="card-text"
            hint="Mark what should be recalled with {{c1::…}}."
          >
            <Textarea
              id="card-text"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.text)}
              placeholder="The mitochondrion is the {{c1::powerhouse}} of the cell."
              className="min-h-24"
              {...clozeField}
              ref={element => {
                clozeField.ref(element);
                clozeRef.current = element;
              }}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={wrapSelection}>
              Blank out selection
            </Button>
            {cardCount > 1 && (
              <p className="text-muted-foreground text-sm">
                {cardCount} deletion groups — saving makes {cardCount} cards.
              </p>
            )}
          </div>
          <Field label="Hint (optional)" error={errors.hint?.message} htmlFor="card-hint">
            <Input
              id="card-hint"
              aria-invalid={Boolean(errors.hint)}
              {...register('hint')}
            />
          </Field>
        </>
      )}

      {kind === 'mcq' && (
        <>
          <Field label="Question" error={errors.stem?.message} htmlFor="card-stem">
            <Textarea
              id="card-stem"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.stem)}
              placeholder="Which organelle produces most of the cell's ATP?"
              {...register('stem')}
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm leading-none font-medium">
              Options — mark the correct one
            </legend>
            {options.fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct-option"
                  className="size-4 shrink-0"
                  aria-label={`Option ${index + 1} is correct`}
                  checked={draft.options[index]?.correct ?? false}
                  onChange={() =>
                    // Exactly one correct answer (schemas.ts refine), so setting
                    // one clears the rest rather than letting the form reach a
                    // state the schema will reject.
                    options.fields.forEach((_option, position) =>
                      setValue(`options.${position}.correct`, position === index, {
                        shouldDirty: true,
                      }),
                    )
                  }
                />
                <Input
                  aria-label={`Option ${index + 1}`}
                  aria-invalid={Boolean(errors.options?.[index]?.text)}
                  {...register(`options.${index}.text`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={options.fields.length <= 3}
                  onClick={() => options.remove(index)}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
            {options.fields.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => options.append({ text: '', correct: false })}
              >
                <PlusIcon /> Add option
              </Button>
            )}
            <FieldError
              message={
                errors.options?.message ??
                errors.options?.root?.message ??
                errors.options?.find?.(option => option?.text?.message)?.text?.message
              }
            />
          </fieldset>

          <Field
            label="Explanation (optional)"
            error={errors.explanation?.message}
            htmlFor="card-explanation"
          >
            <Textarea
              id="card-explanation"
              aria-invalid={Boolean(errors.explanation)}
              {...register('explanation')}
            />
          </Field>
        </>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting
            ? 'Saving…'
            : cardCount > 1
              ? `${submitLabel.replace(/ card$/, '')} ${cardCount} cards`
              : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}
