import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/features/notifications/data/models/notification_model.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_state.dart';
import 'package:phoenix/routes/route_names.dart';

/// The in-app inbox. Reads the single app-wide [NotificationCubit]; the FCM
/// layer keeps it filled. Tapping an order notification re-uses the existing
/// Order Tracking deep-link - it does not own any new navigation.
class NotificationCenterView extends StatefulWidget {
  const NotificationCenterView({super.key});

  @override
  State<NotificationCenterView> createState() => _NotificationCenterViewState();
}

class _NotificationCenterViewState extends State<NotificationCenterView> {
  @override
  void initState() {
    super.initState();
    // Pick up anything the FCM background isolate saved while the app was away.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<NotificationCubit>().refresh();
    });
  }

  void _onTap(NotificationModel notification) {
    context.read<NotificationCubit>().markAsRead(notification.id);
    // Same deep-links FcmService uses on a push tap. Nothing else in the
    // payload carries enough to navigate anywhere, so nothing else does.
    if (notification.hasOrderDeepLink) {
      context.pushNamed(
        RouteNames.orderTracking,
        pathParameters: {'orderId': notification.relatedOrderId!},
      );
    } else if (notification.hasComplaintDeepLink) {
      context.pushNamed(
        RouteNames.complaintDetail,
        pathParameters: {'complaintId': notification.relatedComplaintId!},
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.notificationsTitle),
        actions: [
          BlocBuilder<NotificationCubit, NotificationState>(
            buildWhen: (previous, current) =>
                (previous.unreadCount > 0) != (current.unreadCount > 0),
            builder: (context, state) {
              if (state.unreadCount == 0) return const SizedBox.shrink();
              return TextButton(
                onPressed: () =>
                    context.read<NotificationCubit>().markAllAsRead(),
                child: Text(
                  l10n.markAllAsRead,
                  style: const TextStyle(color: Colors.white),
                ),
              );
            },
          ),
        ],
      ),
      body: BlocBuilder<NotificationCubit, NotificationState>(
        builder: (context, state) {
          if (state.notifications.isEmpty) {
            return EmptyView(
              icon: Icons.notifications_none_outlined,
              message: l10n.noNotificationsYet,
              subtitle: l10n.noNotificationsYetHint,
            );
          }
          return ListView.separated(
            padding: AppPadding.screen,
            itemCount: state.notifications.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AppSizes.spacingSmall),
            itemBuilder: (context, index) {
              final notification = state.notifications[index];
              return _NotificationTile(
                notification: notification,
                onTap: () => _onTap(notification),
              );
            },
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification, required this.onTap});

  final NotificationModel notification;
  final VoidCallback onTap;

  IconData get _typeIcon {
    switch (notification.type) {
      case NotificationType.orderUpdate:
        return Icons.local_shipping_outlined;
      case NotificationType.offer:
        return Icons.local_offer_outlined;
      case NotificationType.system:
        return Icons.campaign_outlined;
      case NotificationType.complaint:
        return Icons.support_agent_outlined;
      case NotificationType.unknown:
        return Icons.notifications_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final unread = !notification.isRead;
    final accent = unread
        ? AppColors.primaryOf(context)
        : AppColors.textSecondaryOf(context);

    return Opacity(
      opacity: unread ? 1 : 0.7,
      child: CustomCard(
        onTap: onTap,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(_typeIcon, size: 19, color: accent),
            ),
            const SizedBox(width: AppSizes.spacingMedium),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          notification.title,
                          style: context.textTheme.titleSmall?.copyWith(
                            fontWeight: unread
                                ? FontWeight.w800
                                : FontWeight.w600,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (unread) ...[
                        const SizedBox(width: AppSizes.spacingSmall),
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(top: 5),
                          decoration: BoxDecoration(
                            color: AppColors.primaryOf(context),
                            shape: BoxShape.circle,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (notification.body.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      notification.body,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Text(
                    DateFormatter.formatDateTime(notification.receivedAt),
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
