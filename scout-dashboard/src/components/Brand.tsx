export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 2L3 5.5V11c0 5.6 3.8 9.8 9 11 5.2-1.2 9-5.4 9-11V5.5L12 2z"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="var(--color-accent-soft)"
      />
      <path
        d="M8.5 12l2.4 2.4L15.8 9.4"
        stroke="var(--color-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight text-ink">
      <BrandMark size={size} />
      Scout
    </span>
  );
}
