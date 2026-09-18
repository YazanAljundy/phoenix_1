import 'package:flutter/foundation.dart';

/// Holds something that belongs to the signed-in account and has to go back
/// to its signed-out shape when that account's session ends.
abstract interface class SessionScoped {
  /// Drops everything that belonged to the account that just signed out.
  ///
  /// Synchronous on purpose: AuthCubit runs it before it reports
  /// `unauthenticated` and before any navigation, so no frame can show the
  /// previous account's data to whoever signs in next.
  void resetForSignOut();
}

/// The pieces of app state that live exactly as long as one sign-in.
///
/// One instance per app, created in main(). AuthCubit calls [resetAll] from
/// its single sign-out cleanup - a deliberate logout (account deletion goes
/// through it too) and a session the server rejected (401) alike - and from
/// nowhere else, so a successful sign-in never clears anything.
///
/// Members register themselves when they are created and unregister when they
/// close. The global cubits are created lazily by their BlocProvider, so one
/// that was never read is simply not here, and has nothing to reset.
///
/// Before this existed, only the notification inbox was cleared on sign-out:
/// the next account on a shared phone got the previous one's cart (and could
/// submit it as its own order), its warehouse list and city scope, and a
/// cold-start notification deep link addressed to the previous pharmacy.
class SessionScope {
  // Insertion-ordered, and identity-based for these members (none of them
  // overrides ==), so one object is registered once however often it asks.
  final Set<SessionScoped> _members = {};

  void register(SessionScoped member) => _members.add(member);

  void unregister(SessionScoped member) => _members.remove(member);

  @visibleForTesting
  int get memberCount => _members.length;

  /// Resets every member. One member failing never stops the others: signing
  /// out has to leave nothing behind, whatever a single reset does.
  void resetAll() {
    // A copy, so a member that unregisters while being reset can't break the
    // loop.
    for (final member in List.of(_members)) {
      try {
        member.resetForSignOut();
      } catch (e) {
        if (kDebugMode) {
          debugPrint('[SESSION] reset failed for ${member.runtimeType}: $e');
        }
      }
    }
  }
}
