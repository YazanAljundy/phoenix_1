import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/features/auth/presentation/views/password_login_view.dart';
import 'package:phoenix/generated/app_localizations.dart';

class MockAuthCubit extends MockCubit<AuthState> implements AuthCubit {}

void main() {
  late MockAuthCubit authCubit;

  setUp(() {
    authCubit = MockAuthCubit();
    when(() => authCubit.state).thenReturn(const AuthState());
    // Returning false makes _submit stop right after the call, so the test
    // never needs a GoRouter for the post-login navigation.
    when(
      () => authCubit.loginWithPassword(
        phone: any(named: 'phone'),
        password: any(named: 'password'),
      ),
    ).thenAnswer((_) async => false);
  });

  Future<void> pumpLoginView(WidgetTester tester) async {
    await tester.pumpWidget(
      BlocProvider<AuthCubit>.value(
        value: authCubit,
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const PasswordLoginView(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<String> phoneSentToBackendFor(WidgetTester tester, String typed) async {
    await pumpLoginView(tester);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), typed); // phone
    await tester.enterText(fields.at(1), 'pharmacist-password'); // password
    await tester.tap(find.byType(PrimaryButton));
    await tester.pump();

    final captured = verify(
      () => authCubit.loginWithPassword(
        phone: captureAny(named: 'phone'),
        password: any(named: 'password'),
      ),
    ).captured.single as String;
    return captured;
  }

  group('PasswordLoginView sends the international phone to loginWithPassword', () {
    const expected = '+963912345678';

    for (final typed in const [
      '0912345678',
      '912345678',
      '963912345678',
      '+963912345678',
      '09 1234 5678',
      '+963 912 345 678',
    ]) {
      testWidgets('"$typed" -> "$expected"', (tester) async {
        expect(await phoneSentToBackendFor(tester, typed), expected);
      });
    }
  });

  testWidgets('password is passed straight through (never logged/altered)', (
    tester,
  ) async {
    await pumpLoginView(tester);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '0912345678');
    await tester.enterText(fields.at(1), 'S3cret-pw!');
    await tester.tap(find.byType(PrimaryButton));
    await tester.pump();

    verify(
      () => authCubit.loginWithPassword(
        phone: '+963912345678',
        password: 'S3cret-pw!',
      ),
    ).called(1);
  });

  testWidgets('an unsupported phone shape fails validation, no call is made', (
    tester,
  ) async {
    await pumpLoginView(tester);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '123456');
    await tester.enterText(fields.at(1), 'pharmacist-password');
    await tester.tap(find.byType(PrimaryButton));
    await tester.pump();

    verifyNever(
      () => authCubit.loginWithPassword(
        phone: any(named: 'phone'),
        password: any(named: 'password'),
      ),
    );
  });
}
