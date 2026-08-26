
// Override at build/run time with:
// flutter run --dart-define=API_BASE_URL=http://localhost:5000/api
// Web and desktop default to localhost; Android emulator uses 10.0.2.2.
// For a physical device use the machine's LAN IP, for example
// http://192.168.1.10:5000/api.
class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 
    'https://phoenix-1-p2qi.onrender.com/api',
    // 'http://localhost:5000/api'
        
  );
}
