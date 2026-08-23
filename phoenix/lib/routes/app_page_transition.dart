import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_duration.dart';

// Fade + a light slide-in from the right (Section 2-a of the visual-polish
// pass, matching the app's default Arabic/RTL reading direction) - replaces
// go_router's default MaterialPage transition. Purely presentational: same
// route graph, same page [child], only how it animates in and out.
CustomTransitionPage<T> buildPageTransition<T>({
  required GoRouterState state,
  required Widget child,
}) {
  return CustomTransitionPage<T>(
    key: state.pageKey,
    child: child,
    transitionDuration: AppDuration.short,
    reverseTransitionDuration: AppDuration.short,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      final curved = CurvedAnimation(parent: animation, curve: Curves.easeOut);
      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0.04, 0),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}
