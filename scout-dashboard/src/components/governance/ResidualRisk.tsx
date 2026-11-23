// Prompt 08's own rule #3: "Never present an allowance without its
// residual risk." This component is the one place that rule is enforced -
// every screen that shows a verdict renders through it rather than
// deciding for itself whether to show the risk text.
export function ResidualRisk({ verdict, residualRisk }: { verdict: string; residualRisk: string | null }) {
  if (verdict !== 'allow') return null;
  if (!residualRisk) {
    return (
      <p className="mt-1 text-xs font-medium text-danger">
        No residual risk recorded for this allowance - this is a defect in the
        decision, not a safe default.
      </p>
    );
  }
  return <p className="mt-1 text-xs text-ink-muted">{residualRisk}</p>;
}
