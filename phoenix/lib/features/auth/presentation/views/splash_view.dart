import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/routes/route_names.dart';

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
      case SessionStatus.unknown:
        // Stays on this screen - handled by the builder (offline retry view
        // or the plain logo while the check is still running).
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<AuthCubit, AuthState>(
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
      buildWhen: (previous, current) =>
          previous.sessionStatus != current.sessionStatus,
      builder: (context, state) {
        if (state.sessionStatus == SessionStatus.offline) {
          return _SplashOffline(
            message: translateErrorCode(
              context.l10n,
              state.errorCode,
              state.errorMessage ?? context.l10n.errorNetwork,
            ),
            onRetry: () => context.read<AuthCubit>().checkSession(),
          );
        }
        return const _SplashLogo();
      },
    );
  }
}

class _SplashLogo extends StatelessWidget {
  const _SplashLogo();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.navyOf(context),
      body: const Center(
        child: Image(
          image: AssetImage('assets/images/feniq_logo.png'),
          width: 200,
          fit: BoxFit.contain,
        ),
      ),
    );
  }
}

// Shown when the stored token could not be validated because the server was
// unreachable (timeout / no connection / 5xx). The token is still saved -
// "Retry" just runs the same GET /auth/me again. The user is never dropped
// onto the Login screen for a connectivity problem.
class _SplashOffline extends StatelessWidget {
  const _SplashOffline({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      backgroundColor: AppColors.navyOf(context),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSizes.spacingLarge),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.12),
                      borderRadius: AppRadius.large,
                    ),
                    child: const Icon(
                      Icons.wifi_off_rounded,
                      color: Colors.white,
                      size: 40,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: context.textTheme.titleMedium?.copyWith(
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  SizedBox(
                    width: double.infinity,
                    height: AppSizes.buttonHeight,
                    child: ElevatedButton.icon(
                      onPressed: onRetry,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: AppColors.navyOf(context),
                        shape: const RoundedRectangleBorder(
                          borderRadius: AppRadius.medium,
                        ),
                      ),
                      icon: const Icon(Icons.refresh),
                      label: Text(l10n.retryButton),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
