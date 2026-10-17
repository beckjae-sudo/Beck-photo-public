import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-4 px-6 text-center select-none">
      <p className="font-black text-sm tracking-tighter uppercase">
        <span>BECK</span>
        <span className="text-blue-500 font-light">/</span>
        <span>PHOTO</span>
      </p>
      <h1 className="text-2xl font-bold">Gallery not found</h1>
      <p className="text-sm text-neutral-400 max-w-sm">
        This gallery does not exist or is not shared publicly.
      </p>
      <Link
        href="/"
        className="mt-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold tracking-widest uppercase transition"
      >
        Back to gallery
      </Link>
    </div>
  );
}
