import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card">
      <h1 className="card-title">Not found</h1>
      <p className="muted">This record does not exist, or it belongs to another organisation.</p>
      <Link className="btn" href="/">
        Back to dashboard
      </Link>
    </div>
  );
}
