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
import 'package:phoenix/features/catalog/data/models/catalog_route_args.dart';
import 'package:phoenix/features/catalog/presentation/managers/manufacturers_cubit.dart';
import 'package:phoenix/features/catalog/presentation/managers/manufacturers_state.dart';
import 'package:phoenix/features/catalog/presentation/widgets/manufacturer_card.dart';
import 'package:phoenix/routes/route_names.dart';

// New step between warehouse selection and the catalog (Section 16):
// warehouse -> manufacturers -> medicines, replacing the old warehouse ->
// medicines flow directly.
class ManufacturersView extends StatelessWidget {
  const ManufacturersView({super.key, required this.warehouseId, required this.warehouseName});

  final String warehouseId;
  final String warehouseName;

  void _handleSelect(BuildContext context, String manufacturer) {
    context.pushNamed(
      RouteNames.catalog,
      pathParameters: {'warehouseId': warehouseId},
      extra: CatalogRouteArgs(warehouseName: warehouseName, manufacturer: manufacturer),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(warehouseName, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: BlocBuilder<ManufacturersCubit, ManufacturersState>(
        builder: (context, state) {
          switch (state.status) {
            case ManufacturersStatus.initial:
            case ManufacturersStatus.loading:
              return const AppLoading();
            case ManufacturersStatus.error:
              return ErrorView(
                message: state.errorMessage ?? l10n.errorState,
                onRetry: () => context.read<ManufacturersCubit>().loadManufacturers(),
              );
            case ManufacturersStatus.loaded:
              if (state.manufacturers.isEmpty) {
                return EmptyView(message: l10n.noManufacturersFound);
              }
              return RefreshIndicator(
                onRefresh: () => context.read<ManufacturersCubit>().loadManufacturers(),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final isWide = constraints.maxWidth >= 700;
                    return GridView.builder(
                      padding: AppPadding.screen,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: isWide ? 2 : 1,
                        mainAxisSpacing: AppSizes.spacingMedium,
                        crossAxisSpacing: AppSizes.spacingMedium,
                        childAspectRatio: isWide ? 4.4 : 3.6,
                      ),
                      itemCount: state.manufacturers.length,
                      itemBuilder: (context, index) {
                        final manufacturer = state.manufacturers[index];
                        return ManufacturerCard(
                          manufacturer: manufacturer,
                          onSelect: () => _handleSelect(context, manufacturer),
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
