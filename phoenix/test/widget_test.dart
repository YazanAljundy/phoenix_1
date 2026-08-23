import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/services/fcm_service.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository_impl.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository_impl.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository_impl.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository_impl.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository_impl.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository_impl.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_state.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository_impl.dart';
import 'package:phoenix/main.dart';

void main() {
  testWidgets('App boots to the splash screen', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final storageService = StorageService(await SharedPreferences.getInstance());
    final secureStorage = SecureStorageService();
    final apiClient = ApiClient(secureStorage: secureStorage);
    final authRepository = AuthRepositoryImpl(apiClient: apiClient);
    final warehouseRepository = WarehouseRepositoryImpl(apiClient: apiClient);
    final catalogRepository = CatalogRepositoryImpl(apiClient: apiClient);
    final exchangeRateRepository = ExchangeRateRepositoryImpl(apiClient: apiClient);
    final orderRepository = OrderRepositoryImpl(apiClient: apiClient);
    final returnRepository = ReturnRepositoryImpl(apiClient: apiClient);
    final reviewRepository = ReviewRepositoryImpl(apiClient: apiClient);
    final debtRepository = DebtRepositoryImpl(apiClient: apiClient);
    final bannersRepository = BannersRepositoryImpl(apiClient: apiClient);
    final fcmService = FcmService(authRepository: authRepository);

    await tester.pumpWidget(
      MyApp(
        initialState: const SettingsState(),
        storageService: storageService,
        secureStorage: secureStorage,
        authRepository: authRepository,
        warehouseRepository: warehouseRepository,
        catalogRepository: catalogRepository,
        exchangeRateRepository: exchangeRateRepository,
        orderRepository: orderRepository,
        returnRepository: returnRepository,
        reviewRepository: reviewRepository,
        debtRepository: debtRepository,
        bannersRepository: bannersRepository,
        fcmService: fcmService,
      ),
    );

    expect(find.text('Phoenix'), findsOneWidget);
  });
}
