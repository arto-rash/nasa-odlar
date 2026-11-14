export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pt-32 sm:px-8" aria-busy>
      <div className="skeleton h-14 w-72" />
      <div className="skeleton mt-4 h-5 w-[480px] max-w-full" />
      <div className="mt-10 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="skeleton aspect-square" />
        <div className="skeleton h-[480px]" />
      </div>
    </div>
  );
}
