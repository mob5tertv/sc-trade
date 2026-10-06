import { describe, expect, it } from 'vitest';
import { createHeldKeyGuard } from '../../src/ui/vm/held-keys';

const down = (code: string) => ({ code, repeat: false });
const repeat = (code: string) => ({ code, repeat: true });

describe('createHeldKeyGuard', () => {
  it('swallows the auto-repeat of a key that was held before the panel opened', () => {
    const guard = createHeldKeyGuard();
    guard.reset();
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
  });

  it('lets the key type once it is pressed again inside the window', () => {
    const guard = createHeldKeyGuard();
    guard.reset();
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
    expect(guard.shouldSwallow(down('KeyF'))).toBe(false);
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(false);
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(false);
  });

  it('swallows the repeat again after the key was released', () => {
    const guard = createHeldKeyGuard();
    guard.reset();
    guard.shouldSwallow(down('KeyF'));
    guard.released('KeyF');
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
  });

  it('keeps other keys independent of a swallowed one', () => {
    const guard = createHeldKeyGuard();
    guard.reset();
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
    expect(guard.shouldSwallow(down('KeyG'))).toBe(false);
    expect(guard.shouldSwallow(repeat('KeyG'))).toBe(false);
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
  });

  it('forgets every mark on reset', () => {
    const guard = createHeldKeyGuard();
    guard.shouldSwallow(down('KeyF'));
    guard.shouldSwallow(down('Escape'));
    guard.reset();
    expect(guard.shouldSwallow(repeat('KeyF'))).toBe(true);
    expect(guard.shouldSwallow(repeat('Escape'))).toBe(true);
  });

  it('never swallows a fresh press, even of a key that was swallowed before', () => {
    const guard = createHeldKeyGuard();
    guard.reset();
    expect(guard.shouldSwallow(repeat('Escape'))).toBe(true);
    expect(guard.shouldSwallow(down('Escape'))).toBe(false);
  });

  it('ignores the release of a key it never saw', () => {
    const guard = createHeldKeyGuard();
    guard.released('KeyX');
    expect(guard.shouldSwallow(repeat('KeyX'))).toBe(true);
  });
});
