const sizes = { sm: "size-8 text-sm", md: "size-11 text-base", lg: "size-20 text-3xl" };

/** Initial-letter avatar on the brand lime. */
export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof sizes }) {
  const initial = name.replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-on-accent ${sizes[size]}`}
    >
      {initial}
    </span>
  );
}
