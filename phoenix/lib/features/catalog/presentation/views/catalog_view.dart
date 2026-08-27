import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_button.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/presentation/managers/catalog_cubit.dart';
import 'package:phoenix/features/catalog/presentation/managers/catalog_state.dart';
import 'package:phoenix/features/catalog/presentation/widgets/product_card.dart';

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
  final _scrollController = ScrollController();
  // Grid vs. list density - purely a local display preference (see
  // ProductCard's `isGrid`), never touches CatalogCubit/the fetched data.
  bool _isGrid = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  // loadMore() already no-ops while a fetch is in flight or there's nothing
  // left to fetch, so firing this on every scroll tick past 80% is safe -
  // no extra guard needed here.
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.maxScrollExtent > 0 && position.pixels >= position.maxScrollExtent * 0.8) {
      context.read<CatalogCubit>().loadMore();
    }
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
        // AppDialog's own action button already pops this confirmation
        // dialog - an extra Navigator.pop(context) here has nothing left of
        // its own to pop and throws, silently aborting this callback before
        // replaceWithProduct() ever runs.
        onAction: () {
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
        toolbarHeight: 64,
        title: BlocBuilder<CatalogCubit, CatalogState>(
          buildWhen: (previous, current) =>
              previous.products.length != current.products.length,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.manufacturer,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  l10n.catalogItemsCountSubtitle(state.products.length),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.normal,
                    color: Colors.white70,
                  ),
                ),
              ],
            );
          },
        ),
        actions: [
          IconButton(
            tooltip: l10n.toggleDensityTooltip,
            onPressed: () => setState(() => _isGrid = !_isGrid),
            icon: Icon(
              _isGrid ? Icons.view_list_outlined : Icons.grid_view_outlined,
            ),
          ),
          const CartButton(),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSizes.spacingMedium,
              0,
              AppSizes.spacingMedium,
              AppSizes.spacingMedium,
            ),
            child: Container(
              height: 46,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSizes.spacingMedium,
              ),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.14),
                borderRadius: AppRadius.medium,
              ),
              child: Row(
                children: [
                  const Icon(Icons.search, color: Colors.white70, size: 20),
                  const SizedBox(width: AppSizes.spacingSmall),
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      cursorColor: Colors.white,
                      onChanged: (value) =>
                          context.read<CatalogCubit>().search(value),
                      decoration: InputDecoration(
                        filled: false,
                        isDense: true,
                        border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              errorBorder: InputBorder.none,
                        hintText: l10n.searchProductsHint,
                        hintStyle: const TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      body: BlocConsumer<CatalogCubit, CatalogState>(
        listenWhen: (previous, current) =>
            current.loadMoreErrorMessage != null &&
            previous.loadMoreErrorMessage != current.loadMoreErrorMessage,
        listener: (context, state) {
          AppSnackbar.show(
            context,
            translateErrorCode(l10n, state.loadMoreErrorCode, state.loadMoreErrorMessage!),
            actionLabel: l10n.retryButton,
            onAction: () => context.read<CatalogCubit>().loadMore(),
          );
        },
        builder: (context, state) {
          if (state.status == CatalogStatus.initial) {
            return const AppLoading();
          }
          if (state.status == CatalogStatus.error && state.products.isEmpty) {
            return FailureWidget(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<CatalogCubit>().initialize(),
            );
          }
          if (state.status == CatalogStatus.loading) {
            return const AppLoading();
          }
          if (state.products.isEmpty) {
            return EmptyView(message: l10n.noProductsFound, icon: Icons.inventory_2_outlined);
          }

          return CustomScrollView(
            controller: _scrollController,
            slivers: [
              SliverPadding(
                padding: AppPadding.screen,
                sliver: _isGrid
                    ? SliverGrid(
                        // Fluid column count - see WarehouseSelectionView for
                        // the same treatment.
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 170,
                          mainAxisSpacing: AppSizes.spacingMedium,
                          crossAxisSpacing: AppSizes.spacingMedium,
                          // 250 wasn't enough: with an active offer, the price
                          // row (strikethrough + discounted + SYP hint) can
                          // wrap to two lines on a narrow card and overflow
                          // the cell - this leaves headroom for that case.
                          mainAxisExtent: 284,
                        ),
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final product = state.products[index];
                            return ProductCard(
                              product: product,
                              onAdd: (quantity) => _handleAdd(product, quantity),
                            );
                          },
                          childCount: state.products.length,
                        ),
                      )
                    : SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final product = state.products[index];
                            final isLast = index == state.products.length - 1;
                            return Padding(
                              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSizes.spacingSmall),
                              child: ProductCard(
                                product: product,
                                isGrid: false,
                                onAdd: (quantity) => _handleAdd(product, quantity),
                              ),
                            );
                          },
                          childCount: state.products.length,
                        ),
                      ),
              ),
              SliverToBoxAdapter(child: _PaginationFooter(state: state)),
            ],
          );
        },
      ),
    );
  }
}

class _PaginationFooter extends StatelessWidget {
  const _PaginationFooter({required this.state});

  final CatalogState state;

  @override
  Widget build(BuildContext context) {
    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSizes.spacingMedium),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (!state.hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingMedium),
        child: Center(
          child: Text(
            context.l10n.noMoreResultsText,
            style: context.textTheme.bodySmall?.copyWith(
              color: AppColors.textSecondaryOf(context),
            ),
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}
