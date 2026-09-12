import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/widgets/app_dialog.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:feniq/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/routes/route_names.dart';

// The one path from "a pharmacist tapped an advertised package" to the cart
// screen, wherever the package was tapped - the warehouse screen's
// AdvertisementCard or the Offers & Ads tab's promotion cards.
//
// Extracted verbatim from AdvertisementCard so a second entry point could not
// grow a second, subtly different version of the re-fetch / incomplete-package
// / cart-conflict rules. Behaviour is unchanged: the package is re-fetched on
// tap, an incomplete one is refused outright, a non-empty cart is replaced
// only after confirmation, and the existing cart is what receives it - there
// is no separate advertisement cart and no intermediate screen.
//
// Callers own their own double-tap guard (the awaited work is a network call).

// Same confirm shape ReorderButton uses - the project's existing conflict copy
// for a cross-warehouse cart, a plainer "replace" prompt otherwise.
Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String content,
  required String actionLabel,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(content),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(false),
          child: Text(dialogContext.l10n.cancel),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(true),
          child: Text(actionLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Loads [advertisementId] into the existing cart and opens the cart screen.
///
/// Shows the app's standard dialog and gives up when the package can't be
/// taken (expired, withdrawn, missing a product, or the pharmacist declined
/// replacing their cart).
Future<void> launchAdvertisementCart(BuildContext context, String advertisementId) async {
  final l10n = context.l10n;
  final isArabic = Localizations.localeOf(context).languageCode == 'ar';
  final repository = context.read<AdvertisementsRepository>();
  final cartCubit = context.read<CartCubit>();

  // Re-fetched on tap rather than trusting the listed copy: the package may
  // have expired, been withdrawn, or lost a product since the list loaded.
  AdvertisementCartPreparation preparation;
  try {
    preparation = await repository.prepareAdvertisementCart(advertisementId);
  } on Failure catch (f) {
    if (context.mounted) {
      await AppDialog.show(
        context: context,
        title: l10n.advertisementUnavailableTitle,
        content: f.code == 'ADVERTISEMENT_UNAVAILABLE'
            ? l10n.advertisementUnavailableMessage
            : translateErrorCode(l10n, f.code, f.errMessage),
      );
    }
    return;
  } catch (_) {
    if (context.mounted) {
      await AppDialog.show(context: context, title: l10n.errorState, content: l10n.errorState);
    }
    return;
  }

  if (!context.mounted) return;

  // Paused by its warehouse or an admin. The server still describes it, but
  // will refuse it at checkout, so it is never added here. A copy that is
  // already sitting in the cart from before the pause is flagged right away,
  // so its warning shows the next time the cart is opened rather than only
  // after a refused checkout.
  if (!preparation.isAvailable) {
    cartCubit.markPackagesUnavailable([preparation.advertisementId]);
    await AppDialog.show(
      context: context,
      title: l10n.advertisementUnavailableTitle,
      content: l10n.advertisementUnavailableMessage,
    );
    return;
  }

  // A package is all-or-nothing: the server rejects an incomplete one at
  // checkout (ADVERTISEMENT_ITEM_MISSING), so it is never half-added here.
  if (!preparation.isComplete) {
    final names = preparation.unavailableItems
        .map((item) => isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr))
        .where((name) => name.isNotEmpty)
        .join(isArabic ? '، ' : ', ');
    await AppDialog.show(
      context: context,
      title: l10n.advertisementUnavailableTitle,
      content: names.isEmpty
          ? l10n.advertisementUnavailableMessage
          : l10n.advertisementIncompleteMessage(names),
    );
    return;
  }

  // A package is now an ordinary cart line, so it simply joins the cart the
  // way a product does - no replacing, and adding the same package again just
  // bumps its copies. Only the one-warehouse-per-cart rule still needs a
  // decision from the pharmacist, and it reuses the project's existing
  // cross-warehouse conflict copy.
  final line = preparation.toCartLine(isArabic: isArabic);
  final warehouseName = isArabic
      ? preparation.warehouseNameAr
      : (preparation.warehouseNameEn ?? preparation.warehouseNameAr);

  if (cartCubit.hasConflictingWarehouse(preparation.warehouseId)) {
    final confirmed = await _confirm(
      context,
      title: l10n.cartConflictTitle,
      content: l10n.cartConflictMessage(cartCubit.state.warehouseName ?? ''),
      actionLabel: l10n.cartConflictConfirmButton,
    );
    if (!confirmed || !context.mounted) return;
    cartCubit.replaceWithPackage(
      line,
      warehouseId: preparation.warehouseId,
      warehouseName: warehouseName,
    );
  } else {
    cartCubit.addPackage(
      line,
      warehouseId: preparation.warehouseId,
      warehouseName: warehouseName,
    );
  }

  context.pushNamed(RouteNames.cart);
}
