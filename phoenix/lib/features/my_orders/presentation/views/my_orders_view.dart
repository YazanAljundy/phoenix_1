import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/features/my_orders/presentation/managers/my_orders_cubit.dart';
import 'package:phoenix/features/my_orders/presentation/managers/my_orders_state.dart';
import 'package:phoenix/features/my_orders/presentation/widgets/order_list_tile.dart';
import 'package:phoenix/routes/route_names.dart';

class MyOrdersView extends StatelessWidget {
  const MyOrdersView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.myOrdersTitle),
      ),
      body: BlocBuilder<MyOrdersCubit, MyOrdersState>(
        builder: (context, state) {
          if (state.status == MyOrdersStatus.initial ||
              (state.status == MyOrdersStatus.loading && state.orders.isEmpty)) {
            return const AppLoading();
          }
          if (state.status == MyOrdersStatus.error && state.orders.isEmpty) {
            return ErrorView(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<MyOrdersCubit>().load(),
            );
          }
          if (state.orders.isEmpty) {
            return EmptyView(message: l10n.noOrdersYet);
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MyOrdersCubit>().load(),
            child: ListView.separated(
              padding: AppPadding.screen,
              itemCount: state.orders.length,
              separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
              itemBuilder: (context, index) {
                final order = state.orders[index];
                return OrderListTile(
                  order: order,
                  onTap: () => context.pushNamed(
                    RouteNames.orderTracking,
                    pathParameters: {'orderId': order.id},
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
