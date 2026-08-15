import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:phoenix/features/returns/presentation/widgets/return_list_tile.dart';
import 'package:phoenix/routes/route_names.dart';

class MyReturnsView extends StatelessWidget {
  const MyReturnsView({super.key});

  Future<void> _edit(BuildContext context, ReturnModel returnRequest) async {
    final result = await showRequestReturnSheet(
      context,
      orderId: returnRequest.orderId,
      existingReturn: returnRequest,
    );
    if (result != null && context.mounted) {
      context.read<MyReturnsCubit>().load();
    }
  }

  Future<void> _delete(BuildContext context, ReturnModel returnRequest) async {
    final l10n = context.l10n;
    final cubit = context.read<MyReturnsCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.deleteReturnConfirmTitle,
      content: l10n.deleteReturnConfirmMessage,
      actionLabel: l10n.deleteReturnButton,
      onAction: () {
        Navigator.pop(context);
        cubit.delete(returnRequest.id);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.returnsTitle),
      ),
      body: BlocBuilder<MyReturnsCubit, MyReturnsState>(
        builder: (context, state) {
          if (state.status == MyReturnsStatus.initial ||
              (state.status == MyReturnsStatus.loading && state.returns.isEmpty)) {
            return const AppLoading();
          }
          if (state.status == MyReturnsStatus.error && state.returns.isEmpty) {
            return ErrorView(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<MyReturnsCubit>().load(),
            );
          }
          if (state.returns.isEmpty) {
            return EmptyView(message: l10n.noReturnsYet);
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MyReturnsCubit>().load(),
            child: ListView.separated(
              padding: AppPadding.screen,
              itemCount: state.returns.length,
              separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
              itemBuilder: (context, index) {
                final returnRequest = state.returns[index];
                return ReturnListTile(
                  returnRequest: returnRequest,
                  onEdit: returnRequest.isPending ? () => _edit(context, returnRequest) : null,
                  onDelete: returnRequest.isPending ? () => _delete(context, returnRequest) : null,
                  onViewReplacementOrder: returnRequest.replacementOrderId != null
                      ? () => context.pushNamed(
                          RouteNames.orderTracking,
                          pathParameters: {'orderId': returnRequest.replacementOrderId!},
                        )
                      : null,
                );
              },
            ),
          );
        },
      ),
    );
  }
}
