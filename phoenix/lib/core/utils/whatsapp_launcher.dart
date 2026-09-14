import 'package:url_launcher/url_launcher.dart';

// Manual password recovery runs through this number until self-service reset
// over SMS is wired up - PasswordLoginView links straight to it. Stored in the
// international form the rest of the app uses; normalized for wa.me below.
const String supportWhatsAppPhone = '+963996230398';

// Warehouse/pharmacy phone numbers are stored in either local Syrian form
// (09XXXXXXXX) or international form (+9639XXXXXXXX) - see
// backend/src/utils/phone.js. wa.me needs plain digits with the country
// code and no leading zero or "+", so both forms are normalized to that
// here before building the link.
String normalizeSyrianPhoneForWhatsApp(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'[^\d]'), '');
  if (digitsOnly.startsWith('963')) return digitsOnly;
  if (digitsOnly.startsWith('0')) return '963${digitsOnly.substring(1)}';
  return digitsOnly;
}

Future<bool> launchWhatsApp(String phone, {String? message}) {
  final normalized = normalizeSyrianPhoneForWhatsApp(phone);
  final uri = Uri.https('wa.me', '/$normalized', message == null ? null : {'text': message});
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}
