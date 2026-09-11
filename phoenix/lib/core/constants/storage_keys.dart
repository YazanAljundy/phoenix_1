class StorageKeys {
  const StorageKeys._();

  static const String authToken = 'auth.token';

  /// The long-lived credential that buys a new [authToken] when it expires
  /// (audit F-03). A separate key rather than a change to the one above, so
  /// an app updating from a build that predates refresh tokens keeps its
  /// session instead of being signed out.
  static const String refreshToken = 'auth.refreshToken';
}
