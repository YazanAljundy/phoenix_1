import 'dart:async';

/// App-wide one-way signal that an *authenticated* API request came back 401.
///
/// [AuthInterceptor] (network layer) emits; [AuthCubit] (state layer) listens
/// and runs the single logout flow. This keeps 401 handling in one place
/// instead of every Cubit doing its own - and lets the interceptor stay
/// unaware of Bloc/GoRouter.
///
/// Singleton, deliberately never closed - same lifetime as the app, like
/// [NavigationService].
class AuthEventBus {
  AuthEventBus._();

  static final AuthEventBus instance = AuthEventBus._();

  final StreamController<void> _unauthorizedController =
      StreamController<void>.broadcast();

  /// Fires once per 401 on an authenticated endpoint. Listeners must guard
  /// against re-entrancy themselves (several requests can 401 at once).
  Stream<void> get onUnauthorized => _unauthorizedController.stream;

  void emitUnauthorized() {
    if (!_unauthorizedController.isClosed) {
      _unauthorizedController.add(null);
    }
  }
}
