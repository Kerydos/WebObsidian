import { FormEvent, useState } from 'react';
import { CircleAlert, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';

interface LoginScreenProps {
  initialError?: string;
  onAuthenticated: () => void;
}

export function LoginScreen({ initialError, onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '로그인에 실패했습니다.');
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={(event) => void login(event)}>
        <span className="login-mark"><Sparkles size={23} /></span>
        <div className="login-heading">
          <h1>WebObsidian</h1>
          <p>서버 볼트를 열려면 로그인하세요.</p>
        </div>
        <label className="login-field">
          <span>비밀번호</span>
          <div>
            <LockKeyhole size={17} />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
        </label>
        {error ? <p className="login-error" role="alert"><CircleAlert size={15} />{error}</p> : null}
        <button className="login-submit" type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle size={16} className="spin" /> : null}
          {submitting ? '로그인 중' : '로그인'}
        </button>
      </form>
    </main>
  );
}
