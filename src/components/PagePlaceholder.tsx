import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Deliberately unstyled-beyond-plain scaffolding. Every route exists so the shell
 * is navigable at the end of P0, and each one says which phase fills it in — an
 * empty page that looks finished is worse than one that admits it is a stub.
 */
export function PagePlaceholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Not built yet — scheduled for <span className="font-medium">{phase}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {children ?? <p>See docs/SPEC.md and docs/plans/ for what belongs here.</p>}
      </CardContent>
    </Card>
  );
}
