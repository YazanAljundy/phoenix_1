import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';

import 'cart_state.dart';

/// How long the warehouse's own order-size limits (CartState.minOrderAmountUsd
/// / maxOrderAmountUsd) are treated as current before an app-resume is worth
/// spending a request on.
///
/// Shorter than ExchangeRateCubit's 10 minutes on purpose: a warehouse
/// changes its own limits by hand, at any moment, and the effect is immediate
/// and binary on this one screen - the submit button is either wrongly
/// enabled (the server then refuses the order) or wrongly disabled (blocked
/// for no reason) - rather than a figure elsewhere in the app being a little
/// off. The cart screen opening still re-reads unconditionally
/// (refreshWarehouseLimits); this only bounds how wrong a cart left open
/// through a background/resume can get.
const Duration kCartLimitsTtl = Duration(minutes: 5);

// Section 6.6: every order belongs to exactly one warehouse, so the cart as a
// whole is scoped to one warehouseId at a time. Registered globally (like
// AuthCubit) since it must survive navigation between the catalog and cart
// screens, and even a trip back to warehouse selection.
//
// It does NOT survive the account: the cart (its lines, its warehouse, its
// pending idempotency key) belongs to whoever built it, so a sign-out resets
// it through SessionScope - otherwise the next pharmacist on the same phone
// would find it, and could submit it as their own order.
class CartCubit extends Cubit<CartState> implements SessionScoped {
  CartCubit({
    required OrderRepository orderRepository,
    required WarehouseRepository warehouseRepository,
    SessionScope? sessionScope,
    // Test seam for the TTL clock; production uses the wall clock.
    DateTime Function()? now,
  })  : _orderRepository = orderRepository,
        _warehouseRepository = warehouseRepository,
        _sessionScope = sessionScope,
        _now = now ?? DateTime.now,
        super(const CartState()) {
    _sessionScope?.register(this);
  }

  final OrderRepository _orderRepository;
  final WarehouseRepository _warehouseRepository;
  final SessionScope? _sessionScope;
  final DateTime Function() _now;
  final Uuid _uuid = const Uuid();

  // Bumped by every sign-out. A submit that was in flight when the account
  // changed must not write its outcome into the next account's cart - see
  // submitOrder.
  int _session = 0;

  // Back to a pristine CartState: lines, warehouse, notes, limits, errors and
  // the pending idempotency key all go. The key named a request of the account
  // that just left; nothing the next one sends may carry it.
  @override
  void resetForSignOut() {
    _session++;
    if (isClosed) return;
    emit(const CartState());
  }

  @override
  Future<void> close() {
    _sessionScope?.unregister(this);
    return super.close();
  }

  // The limits read currently in the air, so the cart screen opening while
  // the warehouse's own fetch is still running makes one request, not two.
  Future<void>? _limitsInFlight;

  /// Re-reads this warehouse's order-size limits.
  ///
  /// Called when the cart screen opens (CartView), on top of the read that
  /// happens when the cart first points at a warehouse. The limits gate the
  /// submit button, and a warehouse can change them while a cart sits open:
  /// with only the original read, a cart that no longer clears a raised
  /// minimum still offered a submit the server would refuse, and one that a
  /// lowered minimum had made valid stayed blocked for no reason.
  ///
  /// A no-op when the cart is not bound to a warehouse yet.
  ///
  /// This is also the only path that raises [CartState.isRefreshingLimits]:
  /// the indicator belongs to the open cart screen asking, not to the silent
  /// read the cart kicks off when it first points at a warehouse - nothing is
  /// on screen to show it then, and every mutation would emit two extra
  /// states for nobody.
  Future<void> refreshWarehouseLimits() async {
    final warehouseId = state.warehouseId;
    if (warehouseId == null) return;
    if (!isClosed) emit(state.copyWith(isRefreshingLimits: true));
    final session = _session;
    try {
      await _loadWarehouseLimits(warehouseId);
    } finally {
      // Down on every path, including a failed read and a cart that moved on.
      if (!isClosed && session == _session && state.isRefreshingLimits) {
        emit(state.copyWith(isRefreshingLimits: false));
      }
    }
  }

  /// Whether the limits on hand are old enough to be worth re-reading.
  ///
  /// No warehouse bound yet, or no successful read yet ([CartState.
  /// limitsFetchedAt] null), counts as stale - there is nothing current to
  /// protect by waiting. So does a timestamp in the future (the device clock
  /// moved).
  bool get limitsAreStale {
    if (state.warehouseId == null) return false;
    final fetchedAt = state.limitsFetchedAt;
    if (fetchedAt == null) return true;
    final age = _now().difference(fetchedAt);
    return age.isNegative || age >= kCartLimitsTtl;
  }

  /// The app-resume path: re-reads the limits only if they have gone stale
  /// (see [limitsAreStale] / [kCartLimitsTtl]) while the cart sat open with
  /// the app in the background. Called from main.dart's single app-resume
  /// observer, alongside ExchangeRateCubit.refreshIfStale - not a listener of
  /// its own, for the same reason.
  ///
  /// Deliberately does NOT raise [CartState.isRefreshingLimits]: unlike
  /// [refreshWarehouseLimits], this can fire with no cart screen anywhere in
  /// view, and raising a flag nothing is showing would be pointless - if the
  /// cart screen does happen to be the one in front, the limits simply
  /// update once the read lands, same as any other background refresh.
  Future<void> refreshLimitsIfStale() {
    if (!limitsAreStale) return Future<void>.value();
    return _loadWarehouseLimits(state.warehouseId!);
  }

  // The warehouse's own order-size limits (backend: warehouse.model.js), so
  // the cart can show the limit and gate the submit button locally instead of
  // only finding out on a rejected submit.
  //
  // Deliberately silent on failure: leaving the limits as they were means a
  // lookup problem can never block an otherwise valid order - order.service.js
  // enforces the real rule either way.
  //
  // Nothing but the limits (and the indicator flag) is touched: the lines, the
  // subtotal, the notes and the pending idempotency key all stay exactly as
  // they are, so a re-read can never disturb a cart being worked on.
  Future<void> _loadWarehouseLimits(String warehouseId) {
    final inFlight = _limitsInFlight;
    if (inFlight != null) return inFlight;
    final request = _readWarehouseLimits(warehouseId).whenComplete(() {
      _limitsInFlight = null;
    });
    _limitsInFlight = request;
    return request;
  }

  Future<void> _readWarehouseLimits(String warehouseId) async {
    final session = _session;
    try {
      final profile = await _warehouseRepository.getWarehouseProfile(warehouseId);
      // Dropped when the cart moved on while this was in the air: a sign-out,
      // or a switch to another warehouse (whose own read is already running).
      if (isClosed || session != _session || state.warehouseId != warehouseId) return;
      emit(
        state.copyWith(
          minOrderAmountUsd: profile.minOrderAmountUsd,
          maxOrderAmountUsd: profile.maxOrderAmountUsd,
          clearMaxOrderAmount: profile.maxOrderAmountUsd == null,
          limitsFetchedAt: _now(),
        ),
      );
    } catch (_) {
      // See above - intentionally ignored; whatever limits the state already
      // holds stand. limitsFetchedAt is untouched too, so the next resume (or
      // screen open) tries again rather than waiting out another TTL on
      // figures that were never actually confirmed.
    }
  }

  bool hasConflictingWarehouse(String warehouseId) =>
      state.items.isNotEmpty && state.warehouseId != warehouseId;

  void addProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
    required int quantity,
  }) {
    // One-warehouse-per-order (Section 6.6): addProduct must never build a
    // mixed cart. The UI resolves a cross-warehouse add first - confirm
    // dialog, then replaceWithProduct - so on the normal path this is never
    // true. It's here so the invariant holds at the cubit level regardless
    // of the caller: a skipped check yields a no-op, not a corrupted cart.
    if (hasConflictingWarehouse(warehouseId)) return;

    final existingIndex = state.items.indexWhere((item) => item.productId == product.id);
    final List<CartItem> updated;
    if (existingIndex >= 0) {
      final existing = state.items[existingIndex];
      updated = List.of(state.items)
        ..[existingIndex] = existing.copyWith(quantity: existing.quantity + quantity);
    } else {
      updated = [...state.items, CartItem.fromProduct(product, quantity: quantity)];
    }
    final warehouseChanged = state.warehouseId != warehouseId;
    emit(
      state.copyWith(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: updated,
        // A different cart now - see CartState.pendingIdempotencyKey.
        clearPendingIdempotencyKey: true,
        clearError: true,
      ),
    );
    if (warehouseChanged) _loadWarehouseLimits(warehouseId);
  }

  // Used after the pharmacist confirms replacing a cart that has items from
  // a different warehouse (see hasConflictingWarehouse).
  void replaceWithProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
    required int quantity,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: [CartItem.fromProduct(product, quantity: quantity)],
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // "Reorder an existing order": replaces the whole cart with a past order's
  // contents, bound to that order's own warehouse (Section 4 - the warehouse
  // comes from the trusted server payload, never client input). Same
  // one-warehouse-per-cart invariant as replaceWithProduct; the caller
  // (ReorderButton) resolves any "you already have a cart" confirmation first.
  // `items` are already priced with the current catalog price by the server -
  // no historical prices are carried over, and checkout re-validates every
  // line as usual.
  void loadReorder({
    required String warehouseId,
    required String warehouseName,
    required List<CartItem> items,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: List.of(items),
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // "Add a package to the cart": a package behaves exactly like a product -
  // ONE line, whose quantity is the number of copies. Adding the same package
  // again bumps that line's copies rather than creating a second one, which is
  // the same rule addProduct applies to a repeated product.
  //
  // The products inside the package are never separate lines: the server
  // builds the real order lines from the package itself at checkout, so the
  // cart only ever names it and says how many.
  void addPackage(
    CartItem packageLine, {
    required String warehouseId,
    required String warehouseName,
  }) {
    if (hasConflictingWarehouse(warehouseId)) return;

    final existingIndex = state.items.indexWhere(
      (item) => item.isPackage && item.packageId == packageLine.packageId,
    );
    final List<CartItem> updated;
    if (existingIndex >= 0) {
      final existing = state.items[existingIndex];
      updated = List.of(state.items)
        ..[existingIndex] = existing.copyWith(
          quantity: existing.quantity + packageLine.quantity,
        );
    } else {
      updated = [...state.items, packageLine];
    }

    final warehouseChanged = state.warehouseId != warehouseId;
    emit(
      state.copyWith(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: updated,
        clearPendingIdempotencyKey: true,
        clearError: true,
      ),
    );
    if (warehouseChanged) _loadWarehouseLimits(warehouseId);
  }

  /// Replaces the whole cart with a single package, for the "your cart holds
  /// another warehouse's items" path - the same shape replaceWithProduct has.
  void replaceWithPackage(
    CartItem packageLine, {
    required String warehouseId,
    required String warehouseName,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: [packageLine],
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // Packages the server has reported as no longer available - paused by their
  // warehouse or an admin after they went into the cart. The lines are kept,
  // not dropped: the tile explains what happened and the pharmacist decides to
  // remove them. Nothing here blocks checkout; the server refuses them there.
  //
  // Keeps the idempotency key: the flag is display-only and never sent, so the
  // request this cart would make is unchanged.
  void markPackagesUnavailable(Iterable<String> packageIds) {
    final ids = packageIds.toSet();
    final needsFlag = state.items.any(
      (item) => item.isPackage && item.isAvailable && ids.contains(item.packageId),
    );
    if (!needsFlag) return;
    emit(state.copyWith(items: _flagUnavailablePackages(ids)));
  }

  /// The one-tap way out of a PACKAGE_UNAVAILABLE refusal: drops every package
  /// line flagged unavailable and leaves the rest of the cart as it was.
  void removeUnavailablePackages() {
    final updated = state.items.where((item) => !(item.isPackage && !item.isAvailable)).toList();
    if (updated.length == state.items.length) return;
    if (updated.isEmpty) {
      emit(const CartState());
      return;
    }
    emit(state.copyWith(items: updated, clearPendingIdempotencyKey: true));
  }

  List<CartItem> _flagUnavailablePackages(Set<String> packageIds) => state.items
      .map((item) => item.isPackage && packageIds.contains(item.packageId)
          ? item.copyWith(isAvailable: false)
          : item)
      .toList();

  // A PRICE_CHANGED refusal names every loose line whose price moved, with the
  // price the server will actually charge (order.service.js). Each one lands on
  // its own line; packages are never price-checked, so a package line is never
  // matched. The line keeps the price the pharmacist had been shown until they
  // confirm the new one (see submitOrder).
  //
  // Both prices take the new figure. The server sends only the final unit
  // price, not the pre-discount one, so there is no knowing whether an offer
  // still applies - and the old "was" price beside a HIGHER new price would
  // read as a discount. A repriced line therefore shows no struck-through
  // price.
  //
  // `changed` is whether a price that gets sent moved at all, which is what
  // decides the idempotency key, exactly as for any other edit.
  ({List<CartItem> items, bool changed}) _applyPriceChanges(Object? problems) {
    final currentPriceByProductId = <String, num>{};
    if (problems is List) {
      for (final problem in problems) {
        if (problem is! Map) continue;
        final productId = problem['productId'];
        final currentPriceUsd = problem['currentPriceUsd'];
        if (productId is String && currentPriceUsd is num) {
          currentPriceByProductId[productId] = currentPriceUsd;
        }
      }
    }

    var changed = false;
    final items = state.items.map((item) {
      final currentPriceUsd = currentPriceByProductId[item.productId];
      if (item.isPackage || currentPriceUsd == null || currentPriceUsd == item.discountPriceUsd) {
        return item;
      }
      changed = true;
      return item.copyWith(
        unitPriceUsd: currentPriceUsd,
        discountPriceUsd: currentPriceUsd,
        previousPriceUsd: item.previousPriceUsd ?? item.discountPriceUsd,
      );
    }).toList();
    return (items: items, changed: changed);
  }

  // Works the same for a product line and a package line: for a package the
  // number IS the copy count. There is no "breaking a package" any more - its
  // contents are not cart lines, so nothing can be taken out of one.
  //
  // The idempotency key goes only when the quantity really moves. The stepper
  // and its typed field can report the value a line already has (a clamped 0,
  // a re-typed number), and dropping the key for that would let a retry after
  // a lost response place the same order twice.
  void updateQuantity(String lineKey, int quantity) {
    final clamped = quantity < 1 ? 1 : quantity;
    final changed = state.items.any(
      (item) => item.lineKey == lineKey && item.quantity != clamped,
    );
    final updated = state.items.map((item) {
      if (item.lineKey != lineKey) return item;
      return item.copyWith(quantity: clamped);
    }).toList();
    emit(state.copyWith(items: updated, clearPendingIdempotencyKey: changed));
  }

  void removeItem(String lineKey) {
    final updated = state.items.where((item) => item.lineKey != lineKey).toList();
    if (updated.isEmpty) {
      emit(const CartState());
      return;
    }
    emit(
      state.copyWith(
        items: updated,
        clearPendingIdempotencyKey: updated.length != state.items.length,
      ),
    );
  }

  // "Clear the cart": drops every line at once. Resets to a pristine
  // CartState rather than just emptying `items` - exactly what removeItem
  // already does when the last line goes - so the warehouse binding, the
  // notes, any advertisement package and the loaded order limits all go with
  // it. Nothing is sent to the server: the cart only exists on the client
  // until submitOrder.
  void clearCart() {
    if (state.isEmpty) return;
    emit(const CartState());
  }

  // Called on every keystroke. Only the trimmed text is ever sent (see
  // submitOrder), so that is what decides whether the idempotency key goes: a
  // call that leaves it as it was (a trailing space) keeps the key. Any real
  // change drops it, and it is not restored if the change is later undone.
  void updateNotes(String notes) => emit(
    state.copyWith(
      notes: notes,
      clearPendingIdempotencyKey: notes.trim() != state.notes.trim(),
    ),
  );

  // Client-side availability snapshots (taken when items were added) can go
  // stale by the time the pharmacist actually submits - the server re-checks
  // isAvailable for real (Section 7/8) and this surfaces whatever
  // human-readable message it returns.
  //
  // `acceptPriceChanges`: the pharmacist has seen the prices the server
  // changed and agreed to them. Only CartView's price-change dialog passes it.
  //
  // `rateUsed`: the USD->SYP rate the totals on screen were converted at, read
  // from ExchangeRateCubit by the view that submits. It is sent so the server
  // can refuse an order agreed to at a rate that has since moved (409
  // RATE_CHANGED, handled by CartView's own confirmation dialog). It is
  // deliberately not part of what identifies this cart: the idempotency key
  // survives a rate change, because nothing about what is being ordered
  // changed.
  Future<OrderModel?> submitOrder({
    bool acceptPriceChanges = false,
    double? rateUsed,
  }) async {
    if (state.warehouseId == null) return null;
    // Unreachable through the normal UI (CartView swaps to its empty-cart
    // view once items.isEmpty), but a real, user-visible message here rather
    // than a silent no-op covers any edge case that still reaches this call
    // - e.g. the last item being removed in the gap between tapping submit
    // and this running.
    if (state.items.isEmpty) {
      emit(state.copyWith(errorMessage: 'Your cart is empty.', errorCode: 'CART_EMPTY'));
      return null;
    }

    // A line the server repriced is never sent on the strength of the
    // pharmacist's earlier confirmation - that one was for the old price.
    if (state.hasUnconfirmedPriceChanges) {
      if (!acceptPriceChanges) {
        // CartView routes a submit to its price-change dialog before it gets
        // here; this is the backstop. The error is cleared first so the
        // listener shows that dialog even if this repeats.
        emit(state.copyWith(clearError: true));
        emit(state.copyWith(
          errorMessage: 'Confirm the new prices before submitting.',
          errorCode: 'PRICE_CHANGE_UNCONFIRMED',
        ));
        return null;
      }
      // Accepting changes nothing that is sent - the lines already carry the
      // new prices - so the idempotency key is left as it is.
      emit(state.copyWith(
        items: [
          for (final item in state.items)
            item.hasUnconfirmedPriceChange ? item.copyWith(clearPreviousPrice: true) : item,
        ],
      ));
    }

    // Money-Flow V2 idempotency: minted on the FIRST attempt only and kept in
    // the state, so every retry of this same cart carries the same key and
    // the server returns the order the first attempt created instead of
    // placing a second one. Generating it inside the request below would give
    // each retry a fresh key and defeat the whole mechanism. It's cleared
    // with the cart itself, on success or on any reset to a bare CartState,
    // and by every edit that changes what this request would send - the key
    // stands for one exact cart, and the server refuses it for any other
    // (IDEMPOTENCY_KEY_REUSED).
    final idempotencyKey = state.pendingIdempotencyKey ?? _uuid.v4();
    emit(state.copyWith(
      isSubmitting: true,
      pendingIdempotencyKey: idempotencyKey,
      clearError: true,
    ));
    // The account this request is sent for. If it signs out before the answer
    // arrives, the answer is dropped: a success would otherwise empty the next
    // account's cart, and a refusal would land its error (or its repriced
    // lines) there. The order itself, if one was placed, belongs to the
    // account that sent it and shows up in that account's order list.
    final session = _session;
    try {
      final order = await _orderRepository.submitOrder(
        warehouseId: state.warehouseId!,
        items: state.items,
        notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
        // The repository splits `items` into loose product lines and packages:
        // a package crosses the wire as { advertisementId, copies } and
        // nothing else, and the server prices it from its own record.
        idempotencyKey: idempotencyKey,
        rateUsed: rateUsed,
      );
      if (session != _session) return null;
      emit(const CartState());
      return order;
    } on Failure catch (f) {
      if (session != _session) return null;
      // Both refusals below rewrite lines in this same emit, so the lines and
      // the dialog explaining them reach the screen together.
      //
      // PACKAGE_UNAVAILABLE names the refused packages, which get flagged.
      // PRICE_CHANGED names the lines whose price moved, which take the new
      // price and wait for the pharmacist to confirm it.
      List<CartItem>? updatedItems;
      var pricesChanged = false;
      if (f.code == 'PRICE_CHANGED') {
        final repriced = _applyPriceChanges(f.details?['problems']);
        updatedItems = repriced.items;
        pricesChanged = repriced.changed;
      } else if (f.code == 'PACKAGE_UNAVAILABLE') {
        final refusedPackageIds = ((f.details?['advertisementIds'] as List?) ?? const [])
            .map((id) => id.toString())
            .toSet();
        if (refusedPackageIds.isNotEmpty) {
          updatedItems = _flagUnavailablePackages(refusedPackageIds);
        }
      }
      // The same principle the repriced lines follow: when the server refuses
      // on a limit it names the limit it applied, so the cart adopts it rather
      // than keeping the figure that let this submit through. The banner and
      // the submit button then tell the truth immediately, without waiting for
      // the next re-read. Only the limit the refusal names is touched - the
      // other one is not in the refusal and must keep its value.
      final num? refusedMinimum = f.code == 'ORDER_BELOW_MINIMUM'
          ? (f.details?['minOrderAmountUsd'] as num?)
          : null;
      final num? refusedMaximum = f.code == 'ORDER_ABOVE_MAXIMUM'
          ? (f.details?['maxOrderAmountUsd'] as num?)
          : null;
      emit(
        state.copyWith(
          items: updatedItems,
          minOrderAmountUsd: refusedMinimum,
          maxOrderAmountUsd: refusedMaximum,
          // The same rule every edit follows: the key names one exact cart.
          // A repriced line sends a different price, so its key goes, just as
          // updateQuantity drops it for a different quantity. (No order holds
          // it - a PRICE_CHANGED refusal is issued before anything is placed -
          // so this keeps the key honest rather than being what unblocks the
          // retry; the new prices are.)
          //
          // IDEMPOTENCY_KEY_REUSED: the server already holds an order for this
          // key, placed from a different cart (only an app that kept its key
          // across an edit gets here). The error tells the pharmacist;
          // dropping the key is what lets their next tap place this cart as
          // the new order it is.
          clearPendingIdempotencyKey: pricesChanged || f.code == 'IDEMPOTENCY_KEY_REUSED',
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
          errorDetails: f.details,
        ),
      );
      return null;
    } catch (e) {
      // Anything that isn't a Failure (e.g. a response-parsing bug) must
      // still land the cubit in a terminal state - otherwise isSubmitting
      // stays true forever and the submit button spins with no error ever
      // shown (the "submit order freezes" report this fixes).
      if (session != _session) return null;
      emit(state.copyWith(isSubmitting: false, errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
      return null;
    }
  }
}
