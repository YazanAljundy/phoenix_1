import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/session/session_scope.dart';

class _Member implements SessionScoped {
  _Member({this.onReset});

  final void Function()? onReset;
  int resets = 0;

  @override
  void resetForSignOut() {
    resets++;
    onReset?.call();
  }
}

void main() {
  test('resetAll resets every registered member once', () {
    final scope = SessionScope();
    final a = _Member();
    final b = _Member();
    scope
      ..register(a)
      ..register(b)
      // Registering twice doesn't reset twice.
      ..register(a);

    scope.resetAll();

    expect(a.resets, 1);
    expect(b.resets, 1);
    expect(scope.memberCount, 2);
  });

  test('an unregistered member is left alone', () {
    final scope = SessionScope();
    final a = _Member();
    scope
      ..register(a)
      ..unregister(a);

    scope.resetAll();

    expect(a.resets, 0);
    expect(scope.memberCount, 0);
  });

  test('one member failing never stops the others, and resetAll does not throw', () {
    final scope = SessionScope();
    final before = _Member();
    final failing = _Member(onReset: () => throw StateError('boom'));
    final after = _Member();
    scope
      ..register(before)
      ..register(failing)
      ..register(after);

    expect(scope.resetAll, returnsNormally);

    expect(before.resets, 1);
    expect(failing.resets, 1);
    expect(after.resets, 1);
  });

  test('a member that unregisters itself while being reset does not break the loop', () {
    final scope = SessionScope();
    late final _Member leaving;
    leaving = _Member(onReset: () => scope.unregister(leaving));
    final other = _Member();
    scope
      ..register(leaving)
      ..register(other);

    scope.resetAll();

    expect(leaving.resets, 1);
    expect(other.resets, 1);
    expect(scope.memberCount, 1);
  });
}
