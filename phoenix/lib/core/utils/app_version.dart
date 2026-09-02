// Semantic version parsing + comparison for the update checker.
//
// Deliberately NOT a string compare: "1.0.10" is newer than "1.0.9" even
// though it sorts earlier lexicographically. Each dotted segment is compared
// as an integer. Build metadata ("+15") and pre-release tags ("-beta.1") are
// stripped before comparing - Phoenix versions the app as `x.y.z+build` and
// only the `x.y.z` part is meaningful for "is there a newer release".
class AppVersion {
  const AppVersion._();

  /// `[major, minor, patch, ...]` or `null` when [raw] is not a usable
  /// numeric dotted version (empty, letters, negative, ...). A missing patch
  /// is treated as 0, so "1.2" parses as `[1, 2, 0]`.
  static List<int>? parse(String raw) {
    final core = raw.trim().split('+').first.split('-').first.trim();
    if (core.isEmpty) return null;

    final segments = core.split('.');
    final out = <int>[];
    for (final segment in segments) {
      final value = int.tryParse(segment.trim());
      if (value == null || value < 0) return null;
      out.add(value);
    }
    if (out.isEmpty) return null;
    while (out.length < 3) {
      out.add(0);
    }
    return out;
  }

  /// -1 / 0 / 1 like [Comparable.compareTo], or `null` when either side is
  /// unparseable. Callers treat `null` as "can't tell -> do nothing".
  static int? compare(String a, String b) {
    final pa = parse(a);
    final pb = parse(b);
    if (pa == null || pb == null) return null;

    final length = pa.length > pb.length ? pa.length : pb.length;
    for (var i = 0; i < length; i++) {
      final x = i < pa.length ? pa[i] : 0;
      final y = i < pb.length ? pb[i] : 0;
      if (x != y) return x < y ? -1 : 1;
    }
    return 0;
  }

  /// True only when both versions parse AND [a] is strictly older than [b].
  /// An unparseable version is never "less than" anything - the update
  /// checker then shows no dialog.
  static bool isLessThan(String a, String b) => compare(a, b) == -1;
}
