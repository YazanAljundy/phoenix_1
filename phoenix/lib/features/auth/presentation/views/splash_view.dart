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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuthCubit>().checkSession();
    });
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthCubit, AuthState>(
      listenWhen: (previous, current) =>
          previous.sessionStatus != current.sessionStatus,
      listener: (context, state) {
        switch (state.sessionStatus) {
          case SessionStatus.unauthenticated:
            context.goNamed(RouteNames.registration);
          case SessionStatus.pendingApproval:
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
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.local_pharmacy_rounded, color: Colors.white, size: 72),
              SizedBox(height: 16),
              Text(
                'Phoenix',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
