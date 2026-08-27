import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/legal/presentation/widgets/privacy_policy_body.dart';

// The in-app privacy policy screen. Reachable from Profile and from the
// registration screen, and - like every route in AppRouter - without being
// signed in. The wording lives in PrivacyPolicyContent (feature data), not
// here; this file is only the screen chrome.
class PrivacyPolicyView extends StatelessWidget {
  const PrivacyPolicyView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(
          context.l10n.privacyPolicy,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: const PrivacyPolicyBody(),
          ),
        ),
      ),
    );
  }
}
