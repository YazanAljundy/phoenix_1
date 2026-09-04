import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_state.dart';
import 'package:phoenix/features/debts/presentation/views/my_debts_view.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_state.dart';
import 'package:phoenix/generated/app_localizations.dart';
import 'package:phoenix/routes/route_names.dart';

class MockDebtsCubit extends MockCubit<DebtsState> implements DebtsCubit {}

class MockExchangeRateCubit extends MockCubit<ExchangeRateState> implements ExchangeRateCubit {}

// The debts page reached from Account History -> Debts must keep working
// after the section was removed from Profile.
void main() {
  testWidgets('renders the warehouse debt and the total from DebtsCubit', (tester) async {
    final debts = MockDebtsCubit();
    final rate = MockExchangeRateCubit();
    when(() => debts.load()).thenAnswer((_) async {});
    when(() => debts.state).thenReturn(
      DebtsState(
        status: DebtsStatus.loaded,
        debts: const [
          WarehouseDebtModel(
            warehouseId: 'w1',
            nameAr: 'مستودع',
            nameEn: 'Warehouse One',
            phone: '0999',
            balanceUsd: 10,
          ),
        ],
      ),
    );
    when(() => rate.state).thenReturn(const ExchangeRateState(usdToSyp: 15000));

    final router = GoRouter(
      initialLocation: '/my-debts',
      routes: [
        GoRoute(
          path: '/my-debts',
          name: RouteNames.myDebts,
          builder: (context, state) => MultiBlocProvider(
            providers: [
              BlocProvider<DebtsCubit>.value(value: debts),
              BlocProvider<ExchangeRateCubit>.value(value: rate),
            ],
            child: const MyDebtsView(),
          ),
        ),
        GoRoute(
          path: '/debts/:warehouseId',
          name: RouteNames.debtDetail,
          builder: (_, __) => const Scaffold(body: Text('DETAIL')),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Warehouse One'), findsOneWidget);
    expect(find.text('Total debts'), findsOneWidget);
    // 10 USD * 15000 = 150,000 SYP (appears for the row and the total)
    expect(find.text('150,000 SYP'), findsNWidgets(2));
  });
}
