import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
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
      listener: (context, state) {
        // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
        debugPrint(
          'ROUTER_DEBUG: SplashView listener -> navigating for ${state.sessionStatus}',
        );
        switch (state.sessionStatus) {
          case SessionStatus.unauthenticated:
            context.goNamed(RouteNames.login);
          case SessionStatus.pendingApproval:
            context.goNamed(RouteNames.approvalPending);
          case SessionStatus.blocked:
            context.goNamed(RouteNames.approvalPending);
          case SessionStatus.active:
            context.goNamed(RouteNames.warehouseSelection);
          case SessionStatus.unknown:
            break;
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.navyOf(context),
        body: const Center(
          child: Image(
            image: AssetImage('assets/images/feniq_logo.png'),
            width: 200,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}
