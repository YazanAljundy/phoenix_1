import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';
import 'package:feniq/features/offers/data/repositories/offers_repository.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_cubit.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_state.dart';

import 'promotions_fixtures.dart';

class _MockOffersRepository extends Mock implements OffersRepository {}

class _MockAdvertisementsRepository extends Mock implements AdvertisementsRepository {}

void main() {
  late _MockOffersRepository offersRepository;
  late _MockAdvertisementsRepository advertisementsRepository;
  late PromotionsCubit cubit;

  setUp(() {
    offersRepository = _MockOffersRepository();
    advertisementsRepository = _MockAdvertisementsRepository();
    cubit = PromotionsCubit(
      offersRepository: offersRepository,
      advertisementsRepository: advertisementsRepository,
    );
  });

  tearDown(() => cubit.close());

  void stub({
    List<OfferModel> offers = const [],
    List<AdvertisementModel> advertisements = const [],
    Failure? offersFailure,
    Failure? advertisementsFailure,
  }) {
    when(() => offersRepository.getActiveOffers()).thenAnswer(
      (_) async => offersFailure != null ? throw offersFailure : offers,
    );
    when(() => advertisementsRepository.getActiveAdvertisements()).thenAnswer(
      (_) async => advertisementsFailure != null ? throw advertisementsFailure : advertisements,
    );
  }

  group('loading', () {
    test('combines both lists into one, deepest saving first', () async {
      stub(
        offers: [offer(id: 'o1', discountPercentage: 10), offer(id: 'o2', discountPercentage: 40)],
        advertisements: [advertisement(id: 'a1', savingPercentage: 25)],
      );

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.loaded);
      expect(cubit.state.promotions.map((p) => p.id).toList(), ['o2', 'a1', 'o1']);
      expect(cubit.state.promotions.map((p) => p.kind).toList(), [
        PromotionKind.offer,
        PromotionKind.package,
        PromotionKind.offer,
      ]);
    });

    test('nothing running is a loaded empty list, never an error', () async {
      stub();

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.loaded);
      expect(cubit.state.promotions, isEmpty);
      expect(cubit.state.totalCount, 0);
    });

    test('one source failing still shows the other half', () async {
      stub(
        advertisements: [advertisement(id: 'a1')],
        offersFailure: ServerFailure('offers are down'),
      );

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.loaded);
      expect(cubit.state.promotions.single.id, 'a1');
    });

    test('both sources failing is the error state', () async {
      stub(
        offersFailure: ServerFailure('offers are down', code: 'SERVER_ERROR'),
        advertisementsFailure: ServerFailure('packages are down'),
      );

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.error);
      expect(cubit.state.errorCode, 'SERVER_ERROR');
    });

    test('a reload drops a warehouse filter that no longer has anything running', () async {
      stub(offers: [offer(id: 'o1', warehouseId: 'W1'), offer(id: 'o2', warehouseId: 'W2')]);
      await cubit.load();
      cubit.filterByWarehouse('W2');
      expect(cubit.state.warehouseFilter, 'W2');

      stub(offers: [offer(id: 'o1', warehouseId: 'W1')]);
      await cubit.load();

      expect(cubit.state.warehouseFilter, isNull);
      expect(cubit.state.filtered, hasLength(1));
    });

    test('a reload keeps a warehouse filter that is still running something', () async {
      stub(offers: [offer(id: 'o1', warehouseId: 'W1'), offer(id: 'o2', warehouseId: 'W2')]);
      await cubit.load();
      cubit.filterByWarehouse('W2');

      await cubit.load();

      expect(cubit.state.warehouseFilter, 'W2');
    });
  });

  group('filtering', () {
    setUp(() async {
      stub(
        offers: [
          offer(id: 'o1', warehouseId: 'W1', discountPercentage: 30),
          offer(id: 'o2', warehouseId: 'W2', discountPercentage: 20),
        ],
        advertisements: [
          advertisement(id: 'a1', warehouseId: 'W1', savingPercentage: 15),
          advertisement(id: 'a2', warehouseId: 'W2', savingPercentage: 10),
        ],
      );
      await cubit.load();
    });

    test('no filter shows everything', () {
      expect(cubit.state.hasFilters, isFalse);
      expect(cubit.state.filtered, hasLength(4));
    });

    test('by kind', () {
      cubit.filterByKind(PromotionKind.package);

      expect(cubit.state.filtered.map((p) => p.id).toList(), ['a1', 'a2']);
      expect(cubit.state.totalCount, 4, reason: 'the app bar still counts everything live');
    });

    test('by warehouse', () {
      cubit.filterByWarehouse('W2');

      expect(cubit.state.filtered.map((p) => p.id).toList(), ['o2', 'a2']);
    });

    test('the two filters compose', () {
      cubit.filterByKind(PromotionKind.offer);
      cubit.filterByWarehouse('W1');

      expect(cubit.state.filtered.map((p) => p.id).toList(), ['o1']);
    });

    test('a combination that matches nothing filters to empty, not to everything', () {
      cubit.filterByKind(PromotionKind.package);
      cubit.filterByWarehouse('W3');

      expect(cubit.state.filtered, isEmpty);
    });

    test('clearing restores the full list', () {
      cubit.filterByKind(PromotionKind.offer);
      cubit.filterByWarehouse('W1');

      cubit.clearFilters();

      expect(cubit.state.hasFilters, isFalse);
      expect(cubit.state.filtered, hasLength(4));
    });

    test('null clears one filter without touching the other', () {
      cubit.filterByKind(PromotionKind.offer);
      cubit.filterByWarehouse('W1');

      cubit.filterByKind(null);

      expect(cubit.state.kindFilter, isNull);
      expect(cubit.state.warehouseFilter, 'W1');
      expect(cubit.state.filtered.map((p) => p.id).toList(), ['o1', 'a1']);
    });

    test('the warehouse picker lists every warehouse, filtered or not', () {
      cubit.filterByWarehouse('W1');

      expect(cubit.state.warehouses.map((w) => w.id).toList(), ['W1', 'W2']);
    });
  });

  group('the featured strip', () {
    test('is the top slice of whatever is currently filtered in', () async {
      stub(
        offers: [
          for (var i = 0; i < 7; i++)
            offer(id: 'o$i', warehouseId: i.isEven ? 'W1' : 'W2', discountPercentage: 50 - i),
        ],
      );
      await cubit.load();

      expect(cubit.state.featured.map((p) => p.id).toList(), ['o0', 'o1', 'o2', 'o3', 'o4']);

      cubit.filterByWarehouse('W2');

      // The hero never shows something the list beneath it has filtered out.
      expect(cubit.state.featured.map((p) => p.id).toList(), ['o1', 'o3', 'o5']);
    });

    test('is the whole list when there is less than a full strip of it', () async {
      stub(offers: [offer(id: 'o1'), offer(id: 'o2')]);
      await cubit.load();

      expect(cubit.state.featured, hasLength(2));
    });
  });

  test('a promotion key stays unique across the two kinds sharing an id', () async {
    stub(offers: [offer(id: 'x')], advertisements: [advertisement(id: 'x')]);

    await cubit.load();

    final keys = cubit.state.promotions.map((p) => p.key).toSet();
    expect(keys, hasLength(2));
  });
}
