import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/widgets/brand_logo.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/routes/route_names.dart';

// The two halves of the logo's breathing animation, keyed so a test can find
// them among the router's own page transitions.
const Key splashLogoFadeKey = ValueKey('splashLogoFade');
const Key splashLogoScaleKey = ValueKey('splashLogoScale');

class SplashView extends StatefulWidget {
  const SplashView({super.key});

  @override
  State<SplashView> createState() => _SplashViewState();
}

class _SplashViewState extends State<SplashView> {
  @override
  void initState() {
    super.initState();
    // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
    debugPrint('ROUTER_DEBUG: SplashView.initState()');
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
      debugPrint(
        'ROUTER_DEBUG: SplashView post-frame -> AuthCubit.checkSession() '
        '(sessionStatus now = ${context.read<AuthCubit>().state.sessionStatus})',
      );
      context.read<AuthCubit>().checkSession();
    });
  }

  void _routeFor(BuildContext context, SessionStatus status) {
    // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
    debugPrint('ROUTER_DEBUG: SplashView listener -> navigating for $status');
    switch (status) {
      case SessionStatus.unauthenticated:
        context.goNamed(RouteNames.login);
      case SessionStatus.pendingApproval:
        context.goNamed(RouteNames.approvalPending);
      case SessionStatus.blocked:
        context.goNamed(RouteNames.approvalPending);
      case SessionStatus.active:
        context.goNamed(RouteNames.warehouseSelection);
      case SessionStatus.offline:
        // The stored token is still present and untouched - the server just
        // could not be reached to re-validate it on this launch. That is not
        // a reason to hold the user on a dead-end "no connection" screen:
        // carry on into the app exactly as for `active`. The warehouse list
        // (and every other screen that needs the network) already shows its
        // own error state with a retry, which is where a genuine outage
        // belongs.
        context.goNamed(RouteNames.warehouseSelection);
      case SessionStatus.unknown:
        // The check is still running - stay on the logo.
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthCubit, AuthState>(
      listenWhen: (previous, current) {
        // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
        debugPrint(
          'ROUTER_DEBUG: SplashView listenWhen prev=${previous.sessionStatus} '
          'curr=${current.sessionStatus} '
          'notify=${previous.sessionStatus != current.sessionStatus}',
        );
        return previous.sessionStatus != current.sessionStatus;
      },
      listener: (context, state) => _routeFor(context, state.sessionStatus),
      child: const _SplashLogo(),
    );
  }
}

class _SplashLogo extends StatefulWidget {
  const _SplashLogo();

  @override
  State<_SplashLogo> createState() => _SplashLogoState();
}

class _SplashLogoState extends State<_SplashLogo>
    with SingleTickerProviderStateMixin {
  // One breath in, one out - ~1.8s per full cycle. Calm enough to read as
  // "alive, still working", never as an animation asking to be looked at.
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  late final Animation<double> _curve = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeInOut,
  );

  late final Animation<double> _scale = Tween<double>(
    begin: 1.0,
    end: 1.04,
  ).animate(_curve);

  late final Animation<double> _opacity = Tween<double>(
    begin: 1.0,
    end: 0.85,
  ).animate(_curve);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.navyOf(context),
      body: Center(
        child: FadeTransition(
          // Keyed so a test can pick this fade out of the page-transition
          // fades the router stacks around it.
          key: splashLogoFadeKey,
          opacity: _opacity,
          child: ScaleTransition(
            key: splashLogoScaleKey,
            scale: _scale,
            child: const BrandLogo.onDark(width: 200),
          ),
        ),
      ),
    );
  }
}
