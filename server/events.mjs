// 볼트 변경 이벤트 버스. 모든 변경(또는 외부 파일 변경 감지)은 이 버스를 통해
// SSE 구독자에게 전달되며, 짧은 시간 안에 반복된 동일 이벤트는 자동으로 제거된다.
export class VaultChangeBus {
  constructor({ now = () => Date.now(), dedupeMs = 1500 } = {}) {
    this.listeners = new Set();
    this.recent = new Map();
    this.now = now;
    this.dedupeMs = dedupeMs;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(change) {
    const timestamp = this.now();
    if (this.recent.size > 512) {
      for (const [key, publishedAt] of this.recent) {
        if (publishedAt + this.dedupeMs <= timestamp) this.recent.delete(key);
      }
    }
    const key = `${change.type}:${change.action}:${change.path ?? ''}:${change.newPath ?? ''}:${change.revision ?? ''}`;
    const publishedAt = this.recent.get(key);
    if (publishedAt !== undefined && timestamp - publishedAt < this.dedupeMs) return false;
    this.recent.set(key, timestamp);
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // 한 구독자의 오류가 다른 구독자의 수신에 영향을 주지 않는다.
      }
    }
    return true;
  }
}