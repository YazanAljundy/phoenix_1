import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_button.dart';
import 'package:phoenix/features/catalog/data/models/catalog_route_args.dart';
import 'package:phoenix/features/catalog/presentation/managers/manufacturers_cubit.dart';
import 'package:phoenix/features/catalog/presentation/managers/manufacturers_state.dart';
import 'package:phoenix/features/catalog/presentation/widgets/manufacturer_card.dart';
import 'package:phoenix/routes/route_names.dart';

// New step between warehouse selection and the catalog (Section 16):
// warehouse -> manufacturers -> medicines, replacing the old warehouse ->
// medicines flow directly.
class ManufacturersView extends StatefulWidget {
  const ManufacturersView({
    super.key,
    required this.warehouseId,
    required this.warehouseName,
    this.autoFilterManufacturer,
  });

  final String warehouseId;
  final String warehouseName;
  // Section: banners - a tapped banner with a linked product skips this
  // screen straight through to its catalog, once the manufacturer list has
  // actually loaded (need it to confirm the manufacturer still has products
  // here before jumping). Never re-triggers on rebuild - see _autoNavigated.
  final String? autoFilterManufacturer;

  @override
  State<ManufacturersView> createState() => _ManufacturersViewState();
}

class _ManufacturersViewState extends State<ManufacturersView> {
  bool _autoNavigated = false;

  void _handleSelect(BuildContext context, String manufacturer) {
    context.pushNamed(
      RouteNames.catalog,
      pathParameters: {'warehouseId': widget.warehouseId},
      extra: CatalogRouteArgs(warehouseName: widget.warehouseName, manufacturer: manufacturer),
    );
  }

  void _maybeAutoNavigate(ManufacturersState state) {
    if (_autoNavigated || widget.autoFilterManufacturer == null) return;
    if (state.status != ManufacturersStatus.loaded) return;
    if (!state.manufacturers.contains(widget.autoFilterManufacturer)) return;

    _autoNavigated = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _handleSelect(context, widget.autoFilterManufacturer!);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        toolbarHeight: 64,
        title: BlocBuilder<ManufacturersCubit, ManufacturersState>(
          buildWhen: (previous, current) => previous.manufacturers.length != current.manufacturers.length,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.warehouseName, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  l10n.manufacturersCountSubtitle(state.manufacturers.length),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.normal, color: Colors.white70),
                ),
              ],
            );
          },
        ),
        actions: const [CartButton()],
      ),
      body: BlocBuilder<ManufacturersCubit, ManufacturersState>(
        builder: (context, state) {
          _maybeAutoNavigate(state);
          switch (state.status) {
            case ManufacturersStatus.initial:
            case ManufacturersStatus.loading:
              return const AppLoading();
            case ManufacturersStatus.error:
              return FailureWidget(
                message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
                onRetry: () => context.read<ManufacturersCubit>().loadManufacturers(),
              );
            case ManufacturersStatus.loaded:
              if (state.manufacturers.isEmpty) {
                return EmptyView(message: l10n.noManufacturersFound, icon: Icons.factory_outlined);
              }
              return RefreshIndicator(
                onRefresh: () => context.read<ManufacturersCubit>().loadManufacturers(),
                child: GridView.builder(
                  padding: AppPadding.screen,
                  // Fluid column count (as many as fit at up to ~160px each)
                  // rather than a fixed 1-vs-2 breakpoint - see
                  // WarehouseSelectionView for the same treatment.
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 160,
                    mainAxisSpacing: AppSizes.spacingMedium,
                    crossAxisSpacing: AppSizes.spacingMedium,
                    mainAxisExtent: 180,
                  ),
                  itemCount: state.manufacturers.length,
                  itemBuilder: (context, index) {
                    final manufacturer = state.manufacturers[index];
                    return ManufacturerCard(
                      manufacturer: manufacturer,
                      onSelect: () => _handleSelect(context, manufacturer),
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
