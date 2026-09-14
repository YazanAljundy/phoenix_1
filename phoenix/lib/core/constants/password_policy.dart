// The client-side password minimum, in one place.
//
// It lives here rather than on Validators because StringExtensions
// (isValidPassword) needs it too, and validators.dart already imports
// string_extensions.dart - putting it on Validators would make that import
// circular. A neutral constant both can depend on avoids that, and is why this
// file exists at all.
//
// This MIRRORS the server's policy; it does not define it. The authority is
// backend/src/utils/password.js, which holds a per-role table:
//
//     pharmacy   8      warehouse  10      admin  12
//
// Only the pharmacy figure is reproduced here, because the pharmacy app is the
// only client that creates or changes a pharmacy password. A warehouse or admin
// credential is never typed into this app, so mirroring the higher minimums
// would only produce a rule no screen here can trigger.
//
// Keep this at or ABOVE the server's pharmacy minimum, never below: a lower
// value just means the form accepts a password the server then rejects with a
// 400, which is a worse experience than catching it in the field.
const int kMinPasswordLength = 8;
