import Link from "next/link";

/**
 * 404 — also the response for /signup and /register (middleware rewrites
 * those paths here so self-registration routes look nonexistent, R-01).
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <p className="text-sm font-medium text-primary-500">404</p>
      <h1 className="mt-2 text-xl font-semibold text-gray-900">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        The page you are looking for doesn&apos;t exist or may have been moved.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex h-11 items-center rounded-md bg-primary-500 px-4 text-sm font-medium text-white shadow-xs transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        Go to sign in
      </Link>
    </main>
  );
}
