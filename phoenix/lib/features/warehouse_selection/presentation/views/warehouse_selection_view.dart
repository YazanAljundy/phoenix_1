import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_selection_state.dart';
import 'package:phoenix/features/warehouse_selection/presentation/widgets/warehouse_card.dart';
import 'package:phoenix/routes/route_names.dart';

class WarehouseSelectionView extends StatefulWidget {
  const WarehouseSelectionView({super.key});

  @override
  State<WarehouseSelectionView> createState() => _WarehouseSelectionViewState();
}

class _WarehouseSelectionViewState extends State<WarehouseSelectionView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<WarehouseSelectionCubit>().loadWarehouses();
    });
  }

  void _handleSelect(WarehouseModel warehouse) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;
    context.pushNamed(
      RouteNames.catalog,
      pathParameters: {'warehouseId': warehouse.id},
      extra: name,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.warehouseSelectionTitle),
      ),
      body: BlocBuilder<WarehouseSelectionCubit, WarehouseSelectionState>(
        builder: (context, state) {
          switch (state.status) {
            case WarehouseListStatus.initial:
            case WarehouseListStatus.loading:
              return const AppLoading();
            case WarehouseListStatus.error:
              return ErrorView(
                message: state.errorMessage ?? l10n.errorState,
                onRetry: () => context.read<WarehouseSelectionCubit>().loadWarehouses(),
              );
            case WarehouseListStatus.loaded:
              if (state.warehouses.isEmpty) {
                return EmptyView(message: l10n.noWarehousesAvailable);
              }
              return RefreshIndicator(
                onRefresh: () => context.read<WarehouseSelectionCubit>().loadWarehouses(),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    // Tablet support via LayoutBuilder, not fixed dimensions
                    // (Section 5): a 2-column grid once there's room for it.
                    final isWide = constraints.maxWidth >= 700;
                    return GridView.builder(
                      padding: AppPadding.screen,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: isWide ? 2 : 1,
                        mainAxisSpacing: AppSizes.spacingMedium,
                        crossAxisSpacing: AppSizes.spacingMedium,
                        childAspectRatio: isWide ? 2.8 : 2.4,
                        mainAxisExtent: isWide ? 210 : 180,
                      ),
                      itemCount: state.warehouses.length,
                      itemBuilder: (context, index) {
                        final warehouse = state.warehouses[index];
                        return WarehouseCard(
                          warehouse: warehouse,
                          onSelect: () => _handleSelect(warehouse),
                        );
                      },
                    );
                  },
                ),
              );
          }
        },
      ),
    );
  }
}
