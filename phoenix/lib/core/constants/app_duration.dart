class AppDuration {
  const AppDuration._();

  static const Duration short = Duration(milliseconds: 250);
  static const Duration medium = Duration(milliseconds: 500);
  static const Duration long = Duration(seconds: 2);

  // Press-and-release scale feedback on buttons/tappable cards.
  static const Duration pressScale = Duration(milliseconds: 100);
  // Per-item delay between staggered card entrances in a list.
  static const Duration staggerStep = Duration(milliseconds: 50);
  // Step transition on the order-tracking progress bar.
  static const Duration stageTransition = Duration(milliseconds: 400);
  // One cycle of the "current stage" pulse on the order-tracking progress bar.
  static const Duration pulse = Duration(milliseconds: 1200);
}
