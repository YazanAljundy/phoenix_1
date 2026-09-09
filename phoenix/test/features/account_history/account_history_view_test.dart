import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/features/account_history/presentation/managers/savings_cubit.dart';
import 'package:feniq/features/account_history/presentation/managers/savings_state.dart';
import 'package:feniq/features/account_history/presentation/views/account_history_view.dart';
import 'package:feniq/features/debts/data/models/warehouse_debt_model.dart';
import 'package:feniq/features/debts/presentation/managers/debts_cubit.dart';
import 'package:feniq/features/debts/presentation/managers/debts_state.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_state.dart';
import 'package:feniq/features/returns/data/models/return_model.dart';
import 'package:feniq/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:feniq/features/returns/presentation/managers/my_returns_state.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/features/account_history/data/models/savings_summary.dart';
import 'package:feniq/routes/route_names.dart';

class MockSavingsCubit extends MockCubit<SavingsState> implements SavingsCubit {}

class MockDebtsCubit extends MockCubit<DebtsState> implements DebtsCubit {}

class MockMyReturnsCubit extends MockCubit<MyReturnsState> implements MyReturnsCubit {}

class MockExchangeRateCubit extends MockCubit<ExchangeRateState> implements ExchangeRateCubit {}

// Money-Flow V2: balances are SYP-native (the ledger's settlement currency)
// and frozen, so nothing here converts through an exchange rate.
WarehouseDebtModel _debt(num syp) => WarehouseDebtModel(
  warehouseId: 'w1',
  nameAr: 'مستودع',
  nameEn: 'Warehouse',
  phone: '0999',
  balanceSyp: syp,
);

ReturnModel _return(String id) => ReturnModel(
  id: id,
  orderId: 'o-$id',
  items: const [],
  status: 'pending',
  createdAt: DateTime(2026, 1, 1),
);

void main() {
  late MockSavingsCubit savings;
  late MockDebtsCubit debts;
  late MockMyReturnsCubit returns;
  late MockExchangeRateCubit rate;

  setUp(() {
    savings = MockSavingsCubit();
    debts = MockDebtsCubit();
    returns = MockMyReturnsCubit();
    rate = MockExchangeRateCubit();

    when(() => savings.state).thenReturn(
      const SavingsState(
        status: SavingsStatus.loaded,
        savings: SavingsSummary(
          offerAndManufacturerSyp: 100000,
          advertisementSyp: 0,
          platformDiscountSyp: 50000,
          totalSavingsSyp: 150000,
          totalSavingsUsd: 10,
        ),
      ),
    );
    when(() => debts.state).thenReturn(
      DebtsState(
        status: DebtsStatus.loaded,
        summary: DebtsSummaryModel(
          totalDebtSyp: 300000,
          totalCreditSyp: 0,
          netPositionSyp: 300000,
          accounts: [_debt(300000)],
        ),
      ),
    );
    when(() => returns.state).thenReturn(
      MyReturnsState(status: MyReturnsStatus.loaded, returns: [_return('1'), _return('2'), _return('3')]),
    );
    when(() => rate.state).thenReturn(const ExchangeRateState(usdToSyp: 15000));
    // The view only calls load() on pull-to-refresh, which these tests never
    // trigger - so no load() stubbing is needed.
  });

  // `settle: false` for any test that leaves a card in its loading state: the
  // amount placeholder is a skeleton that pulses forever, so such a screen
  // never reaches a settled frame.
  Future<void> pump(
    WidgetTester tester, {
    Locale? locale,
    ThemeData? theme,
    bool settle = true,
  }) async {
    final router = GoRouter(
      initialLocation: '/account-history',
      routes: [
        GoRoute(
          path: '/account-history',
          name: RouteNames.accountHistory,
          builder: (context, state) => MultiBlocProvider(
            providers: [
              BlocProvider<SavingsCubit>.value(value: savings),
              BlocProvider<DebtsCubit>.value(value: debts),
              BlocProvider<MyReturnsCubit>.value(value: returns),
              BlocProvider<ExchangeRateCubit>.value(value: rate),
            ],
            child: const AccountHistoryView(),
          ),
        ),
        GoRoute(
          path: '/my-debts',
          name: RouteNames.myDebts,
          builder: (_, __) => const Scaffold(body: Text('DEBTS PAGE')),
        ),
        GoRoute(
          path: '/my-returns',
          name: RouteNames.myReturns,
          builder: (_, __) => const Scaffold(body: Text('RETURNS PAGE')),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        locale: locale,
        theme: theme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
    }
  }

  testWidgets('Test 2: shows all three cards', (tester) async {
    await pump(tester);

    expect(find.text('Money Saved'), findsOneWidget);
    expect(find.text('Debts'), findsOneWidget);
    expect(find.text('Returns'), findsOneWidget);
    expect(find.text('From Discounts'), findsOneWidget);
    expect(find.text('Outstanding Balance'), findsOneWidget);
    expect(find.text('View Returns'), findsOneWidget);
  });

  testWidgets('Test 3: the saved amount is shown in SYP', (tester) async {
    await pump(tester);
    // 10 USD * 15000 = 150,000 SYP
    expect(find.text('150,000 SYP'), findsOneWidget);
  });

  testWidgets('Test 4: the outstanding debt total is shown in SYP', (tester) async {
    await pump(tester);
    // 20 USD * 15000 = 300,000 SYP
    expect(find.text('300,000 SYP'), findsOneWidget);
  });

  testWidgets('Test 5: the return count is shown', (tester) async {
    await pump(tester);
    expect(find.text('3 requests'), findsOneWidget);
  });

  testWidgets('Test 6: tapping the Debts card opens the existing debts page', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Debts'));
    await tester.pumpAndSettle();

    expect(find.text('DEBTS PAGE'), findsOneWidget);
  });

  testWidgets('Test 7: tapping the Returns card opens the existing Returns page', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Returns'));
    await tester.pumpAndSettle();

    expect(find.text('RETURNS PAGE'), findsOneWidget);
  });

  testWidgets('Test 7b: a card loads independently - debts still render while savings is loading', (
    tester,
  ) async {
    when(() => savings.state).thenReturn(const SavingsState(status: SavingsStatus.loading));
    await pump(tester, settle: false);

    expect(find.text('150,000 SYP'), findsNothing); // savings not ready
    expect(find.text('300,000 SYP'), findsOneWidget); // debts unaffected
    expect(find.text('3 requests'), findsOneWidget); // returns unaffected
  });

  testWidgets('Test 10: strings are localized to Arabic', (tester) async {
    await pump(tester, locale: const Locale('ar'));

    expect(find.text('سجل الحسابات'), findsOneWidget); // app bar title
    expect(find.text('الديون'), findsOneWidget);
    expect(find.text('من الخصومات'), findsOneWidget);
  });

  testWidgets('Test 11: renders in dark mode without error', (tester) async {
    await pump(tester, theme: DarkTheme.data);

    expect(tester.takeException(), isNull);
    expect(find.byType(AccountHistoryView), findsOneWidget);
    expect(find.text('150,000 SYP'), findsOneWidget);
  });
}
