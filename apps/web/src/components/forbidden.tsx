import Link from 'next/link';

/** Shown when the signed-in user lacks the permission for a page. */
export function Forbidden() {
  return (
    <div className="card" role="alert">
      <h1 className="card-title">You don’t have access to this page</h1>
      <p className="muted">
        Ask an administrator of your organisation for a role that includes this access.
      </p>
      <Link className="btn" href="/">
        Back to dashboard
      </Link>
    </div>
  );
}
