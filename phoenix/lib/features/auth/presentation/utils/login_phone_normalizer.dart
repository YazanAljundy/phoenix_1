/// Turns whatever the pharmacist types in the login phone field into the one
/// international form the backend accepts: `+9639XXXXXXXX`.
///
/// Whitespace anywhere is stripped first, then the local shape is mapped:
///
/// | Typed            | Result           | Rule                        |
/// | ---------------- | ---------------- | --------------------------- |
/// | `09XXXXXXXX`     | `+9639XXXXXXXX`  | drop leading `0`, add `+963` |
/// | `9XXXXXXXX`      | `+9639XXXXXXXX`  | add `+963`                  |
/// | `9639XXXXXXXX`   | `+9639XXXXXXXX`  | add `+`                     |
/// | `+9639XXXXXXXX`  | `+9639XXXXXXXX`  | unchanged                   |
///
/// Anything that matches none of those shapes is returned whitespace-stripped
/// but otherwise untouched, so the field validator stays responsible for
/// rejecting it - this helper never tries to "repair" a malformed number.
///
/// Login-only: registration/OTP compose their number through
/// `phoneTextFieldFullValue` and are intentionally left alone.
String normalizeLoginPhone(String raw) {
  final cleaned = raw.replaceAll(RegExp(r'\s'), '');

  if (RegExp(r'^\+9639\d{8}$').hasMatch(cleaned)) return cleaned;
  if (RegExp(r'^9639\d{8}$').hasMatch(cleaned)) return '+$cleaned';
  if (RegExp(r'^09\d{8}$').hasMatch(cleaned)) return '+963${cleaned.substring(1)}';
  if (RegExp(r'^9\d{8}$').hasMatch(cleaned)) return '+963$cleaned';

  return cleaned;
}
