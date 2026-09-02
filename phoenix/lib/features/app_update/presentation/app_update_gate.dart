import 'package:flutter/material.dart';
import 'package:phoenix/core/services/app_update_service.dart';
import 'package:phoenix/core/services/navigation_service.dart';
import 'package:phoenix/features/app_update/presentation/app_update_dialog.dart';

// Runs the update check ONCE per app launch, after the first frame, and shows
// the right dialog for `optional` / `mandatory`. `none` does nothing at all -
// no dialog, no snackbar, no banner (requirement section 8).
//
// It sits high in the tree (wraps the router's content) so it lives for the
// whole session, but it shows the dialog through
// NavigationService.instance.navigatorKey - the same navigator FcmService
// deep-links through.
//
// Auth-independent: fired from initState, not gated on login / session
// restore / which screen is showing. It does wait for the app to leave the
// splash screen first, so the splash -> first-screen navigation can't pop the
// dialog out from under the user; a mandatory dialog is then re-shown if it is
// ever dismissed by anything other than the user actually updating.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({
    super.key,
    required this.service,
    required this.isAppShellReady,
    required this.child,
  });

  final AppUpdateService service;

  /// True once the router has navigated away from the splash route.
  final bool Function() isAppShellReady;

  final Widget child;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate> {
  // Static so a hot-reload / widget rebuild can't run the check twice, and so
  // an optional dialog is never shown more than once per app session
  // (requirement section 6).
  static bool _ranThisSession = false;

  @override
  void initState() {
    super.initState();
    if (_ranThisSession) return;
    _ranThisSession = true;
    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  Future<void> _run() async {
    final status = await widget.service.checkForUpdate();
    if (status == AppUpdateStatus.none || !mounted) return;

    // Wait for the shell to be on screen (capped ~10s) so a splash -> next
    // `go()` doesn't immediately dismiss the dialog.
    for (var i = 0; i < 40 && mounted && !widget.isAppShellReady(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }

    final mandatory = status == AppUpdateStatus.mandatory;
    do {
      final context = NavigationService.instance.navigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      await showAppUpdateDialog(context, mandatory: mandatory, service: widget.service);
      // A mandatory update has no "Later" and no dismissible barrier - if it
      // still closed (a route change, say), bring it straight back.
      if (mandatory) await Future<void>.delayed(const Duration(milliseconds: 300));
    } while (mandatory && mounted);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
