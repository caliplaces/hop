const sizes = { sm: "size-8 text-sm", md: "size-11 text-base", lg: "size-20 text-3xl" };

/** A profile photo, or without one, an initial-letter avatar on the brand lime. */
export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  /** The photo's URL, if they set one. */
  src?: string | null;
  size?: keyof typeof sizes;
}) {
  if (src) {
    // The name is always shown beside it, so the photo itself says nothing more.
    return (
      <img
        src={src}
        alt=""
        className={`shrink-0 rounded-full bg-surface-2 object-cover ${sizes[size]}`}
      />
    );
  }
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
