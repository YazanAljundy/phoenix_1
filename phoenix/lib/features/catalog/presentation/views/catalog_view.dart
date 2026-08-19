import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_state.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/presentation/managers/catalog_cubit.dart';
import 'package:phoenix/features/catalog/presentation/managers/catalog_state.dart';
import 'package:phoenix/features/catalog/presentation/widgets/category_filter_bar.dart';
import 'package:phoenix/features/catalog/presentation/widgets/product_card.dart';
import 'package:phoenix/routes/route_names.dart';

class CatalogView extends StatefulWidget {
  const CatalogView({
    super.key,
    required this.warehouseId,
    required this.warehouseName,
    required this.manufacturer,
  });

  final String warehouseId;
  // Still needed for cart operations (CartCubit.addProduct, the conflicting-
  // warehouse dialog) even though the AppBar now shows `manufacturer`
  // instead of this - see CatalogRouteArgs.
  final String warehouseName;
  final String manufacturer;

  @override
  State<CatalogView> createState() => _CatalogViewState();
}

class _CatalogViewState extends State<CatalogView> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _handleAdd(ProductModel product, int quantity) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? product.nameAr : (product.nameEn ?? product.nameAr);
    final cartCubit = context.read<CartCubit>();

    // Section 6.6: every order belongs to exactly one warehouse, so a cart
    // that already has items from a different warehouse needs confirmation
    // before it gets cleared and restarted here.
    if (cartCubit.hasConflictingWarehouse(widget.warehouseId)) {
      AppDialog.show(
        context: context,
        title: l10n.cartConflictTitle,
        content: l10n.cartConflictMessage(cartCubit.state.warehouseName ?? ''),
        actionLabel: l10n.cartConflictConfirmButton,
        onAction: () {
          Navigator.pop(context);
          cartCubit.replaceWithProduct(
            product,
            warehouseId: widget.warehouseId,
            warehouseName: widget.warehouseName,
            quantity: quantity,
          );
          AppSnackbar.show(context, l10n.addedToCartMessage(name));
        },
      );
      return;
    }

    cartCubit.addProduct(
      product,
      warehouseId: widget.warehouseId,
      warehouseName: widget.warehouseName,
      quantity: quantity,
    );
    AppSnackbar.show(context, l10n.addedToCartMessage(name));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(widget.manufacturer, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          BlocBuilder<CartCubit, CartState>(
            buildWhen: (previous, current) => previous.itemCount != current.itemCount,
            builder: (context, cartState) {
              return IconButton(
                tooltip: l10n.cartIconTooltip,
                onPressed: () => context.pushNamed(RouteNames.cart),
                icon: Badge(
                  label: Text('${cartState.itemCount}'),
                  isLabelVisible: cartState.itemCount > 0,
                  child: const Icon(Icons.shopping_cart_outlined),
                ),
              );
            },
          ),
        ],
      ),
      body: BlocBuilder<CatalogCubit, CatalogState>(
        builder: (context, state) {
          if (state.status == CatalogStatus.initial) {
            return const AppLoading();
          }
          if (state.status == CatalogStatus.error && state.products.isEmpty) {
            return ErrorView(
              message: state.errorMessage ?? l10n.errorState,
              onRetry: () => context.read<CatalogCubit>().initialize(),
            );
          }

          return Column(
            children: [
              Padding(
                padding: AppPadding.screen,
                child: AppTextField(
                  label: l10n.searchProductsHint,
                  controller: _searchController,
                  prefixIcon: const Icon(Icons.search),
                  onChanged: (value) => context.read<CatalogCubit>().search(value),
                ),
              ),
              if (state.categories.isNotEmpty)
                CategoryFilterBar(
                  categories: state.categories,
                  selectedCategoryId: state.selectedCategoryId,
                  onSelect: (categoryId) =>
                      context.read<CatalogCubit>().selectCategory(categoryId),
                ),
              const SizedBox(height: AppSizes.spacingSmall),
              Expanded(
                child: state.status == CatalogStatus.loading
                    ? const AppLoading()
                    : state.products.isEmpty
                    ? EmptyView(message: l10n.noProductsFound)
                    : LayoutBuilder(
                        builder: (context, constraints) {
                          final isWide = constraints.maxWidth >= 700;
                          return GridView.builder(
                            padding: AppPadding.screen,
                            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: isWide ? 2 : 1,
                              mainAxisSpacing: AppSizes.spacingMedium,
                              crossAxisSpacing: AppSizes.spacingMedium,
                              childAspectRatio: isWide ? 2.6 : 2.2,
                            ),
                            itemCount: state.products.length,
                            itemBuilder: (context, index) {
                              final product = state.products[index];
                              return ProductCard(
                                product: product,
                                onAdd: (quantity) => _handleAdd(product, quantity),
                              );
                            },
                          );
                        },
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}
