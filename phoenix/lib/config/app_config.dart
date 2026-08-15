// Override at build/run time with:
// flutter run --dart-define=API_BASE_URL=http://localhost:4000/api
// The default targets the Android emulator's alias for the host machine's
// localhost. Use http://localhost:4000/api for iOS simulator/desktop, or the
// machine's LAN IP for a physical device.
class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:5000/api',
  );
}
