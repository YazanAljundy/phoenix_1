import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_state.dart';
import 'package:phoenix/routes/route_names.dart';

/// The bell + unread-count badge for the home AppBar. Deliberately mirrors
/// [CartButton]: reads the single app-wide [NotificationCubit], only rebuilds
/// when the unread count changes, and pushes the existing notifications route.
class NotificationButton extends StatelessWidget {
  const NotificationButton({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocBuilder<NotificationCubit, NotificationState>(
      buildWhen: (previous, current) =>
          previous.unreadCount != current.unreadCount,
      builder: (context, state) {
        final count = state.unreadCount;
        return IconButton(
          tooltip: l10n.notificationsTitle,
          onPressed: () => context.pushNamed(RouteNames.notifications),
          icon: Badge(
            label: Text(count > 99 ? '99+' : '$count'),
            isLabelVisible: count > 0,
            child: Icon(
              count > 0 ? Icons.notifications : Icons.notifications_outlined,
            ),
          ),
        );
      },
    );
  }
}
